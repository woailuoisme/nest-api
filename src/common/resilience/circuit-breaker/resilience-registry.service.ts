import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type BulkheadPolicy,
  bulkhead,
  type CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  ConstantBackoff,
  circuitBreaker,
  ExponentialBackoff,
  fullJitterGenerator,
  handleAll,
  type IPolicy,
  noJitterGenerator,
  noop,
  type RetryPolicy,
  retry,
  SamplingBreaker,
  TimeoutStrategy,
  timeout,
  wrap,
} from 'cockatiel';
import { RedisService } from '@/database/redis.service';
import { RateLimiterPolicy } from '../rate-limiter/rate-limiter.policy';
import type { RateLimitOptions } from '../rate-limiter/rate-limiter.types';
import type {
  BulkheadOptions,
  CircuitBreakerOptions,
  CircuitBreakerStats,
  CircuitStateName,
  ResilientOptions,
  RetryOptions,
  TimeoutPolicyOptions,
} from './circuit-breaker.types';

@Injectable()
export class ResilienceRegistryService {
  private static instance?: ResilienceRegistryService;
  private readonly logger = new Logger(ResilienceRegistryService.name);

  /** 断路器单例缓存表 (name -> CircuitBreakerPolicy) */
  private readonly breakers = new Map<string, CircuitBreakerPolicy>();

  /** 仓壁单例缓存表 (name -> BulkheadPolicy) */
  private readonly bulkheads = new Map<string, BulkheadPolicy>();

  /** 出站限流器单例缓存表 (name -> RateLimiterPolicy) */
  private readonly rateLimiters = new Map<string, RateLimiterPolicy>();

  /** 复合流水线缓存表 (name -> IPolicy) */
  private readonly pipelines = new Map<string, IPolicy>();

  constructor(@Optional() private readonly redisService?: RedisService) {
    ResilienceRegistryService.instance = this;
  }

  /**
   * 获取全局单例注册中心实例（供声明式装饰器或无注入环境使用）
   */
  static getShared(): ResilienceRegistryService {
    if (!ResilienceRegistryService.instance) {
      ResilienceRegistryService.instance = new ResilienceRegistryService();
    }
    return ResilienceRegistryService.instance;
  }

  /**
   * 获取或创建出站配额限流器实例 (单例复用)
   */
  getOrCreateRateLimiter(name: string, options: RateLimitOptions): RateLimiterPolicy {
    const existing = this.rateLimiters.get(name);
    if (existing) {
      return existing;
    }

    const policy = new RateLimiterPolicy(name, options, this.redisService);
    this.rateLimiters.set(name, policy);
    return policy;
  }

  /**
   * 根据名称获取指定出站配额限流器实例（若不存在返回 undefined）
   */
  getRateLimiter(name: string): RateLimiterPolicy | undefined {
    return this.rateLimiters.get(name);
  }

  /**
   * 获取或创建一个命名的断路器实例 (单例复用)
   */
  getOrCreateCircuitBreaker(name: string, options: CircuitBreakerOptions = {}): CircuitBreakerPolicy {
    const existing = this.breakers.get(name);
    if (existing) {
      return existing;
    }

    const halfOpenAfter = options.halfOpenAfterMs ?? options.resetTimeoutMs ?? 10_000;
    const consecutive = options.consecutiveFailures ?? options.failureThreshold ?? 5;

    const breakerStrategy = options.sampling
      ? new SamplingBreaker({
          threshold: options.sampling.failureRatio,
          duration: options.sampling.durationMs,
          minimumRps: options.sampling.minimumRps ?? 1,
        })
      : new ConsecutiveBreaker(consecutive);

    const breaker = circuitBreaker(handleAll, {
      halfOpenAfter,
      breaker: breakerStrategy,
    });

    // 绑定项目 Pino 结构化日志
    breaker.onBreak((event) => {
      const err = (event as { error?: unknown })?.error ?? event;
      this.logger.warn({
        msg: `Circuit breaker [${name}] tripped: CLOSED -> OPEN`,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    breaker.onReset(() => {
      this.logger.log({
        msg: `Circuit breaker [${name}] recovered: -> CLOSED`,
      });
    });

    breaker.onHalfOpen(() => {
      this.logger.warn({
        msg: `Circuit breaker [${name}] probationary trial: -> HALF_OPEN`,
      });
    });

    this.breakers.set(name, breaker);
    return breaker;
  }

  /**
   * 获取或创建仓壁并发隔离实例 (单例复用)
   */
  getOrCreateBulkhead(name: string, options: BulkheadOptions): BulkheadPolicy {
    const existing = this.bulkheads.get(name);
    if (existing) {
      return existing;
    }

    const policy = bulkhead(options.maxConcurrent, options.maxQueue ?? 0);

    policy.onReject(() => {
      this.logger.warn({
        msg: `Bulkhead [${name}] capacity exhausted: request rejected`,
        maxConcurrent: options.maxConcurrent,
        maxQueue: options.maxQueue ?? 0,
      });
    });

    this.bulkheads.set(name, policy);
    return policy;
  }

  /**
   * 创建重试策略实例
   */
  createRetryPolicy(name: string, options: RetryOptions = {}): RetryPolicy {
    const maxAttempts = options.attempts ?? 3;
    const initialDelay = options.initialDelayMs ?? 500;
    const maxDelay = options.maxDelayMs ?? 5_000;
    const useJitter = options.jitter ?? true;

    const backoff =
      options.backoff === 'constant'
        ? new ConstantBackoff(initialDelay)
        : new ExponentialBackoff({
            initialDelay,
            maxDelay,
            generator: useJitter ? fullJitterGenerator : noJitterGenerator,
          });

    const policy = retry(handleAll, {
      maxAttempts,
      backoff,
    });

    policy.onRetry((reason) => {
      this.logger.warn({
        msg: `Retry attempt for [${name}]`,
        attempt: (reason as { attempt?: number }).attempt,
        delay: (reason as { delay?: number }).delay,
      });
    });

    return policy;
  }

  /**
   * 根据配置构建 Polly 经典金字塔组合流水线
   * 执行顺序（由外到内）：Retry -> CircuitBreaker -> RateLimiter -> Bulkhead -> Timeout -> Target
   */
  getOrCreatePipeline(name: string, options: ResilientOptions): IPolicy {
    const existing = this.pipelines.get(name);
    if (existing) {
      return existing;
    }

    const policies: IPolicy[] = [];

    // 1. Retry (最外层网络/瞬时故障重试)
    if (options.retry) {
      const retryOpts = typeof options.retry === 'object' ? options.retry : {};
      policies.push(this.createRetryPolicy(name, retryOpts));
    }

    // 2. Circuit Breaker (重试耗尽后熔断器统计失败率)
    if (options.circuitBreaker !== false) {
      const cbOpts = typeof options.circuitBreaker === 'object' ? options.circuitBreaker : {};
      policies.push(this.getOrCreateCircuitBreaker(name, cbOpts));
    }

    // 3. RateLimiter (断路器放行后，核验并扣减出站配额，支持毫秒级排队整形)
    if (options.rateLimit) {
      policies.push(this.getOrCreateRateLimiter(name, options.rateLimit));
    }

    // 4. Bulkhead (进入具体调用前的并发配额隔离)
    if (options.bulkhead) {
      policies.push(this.getOrCreateBulkhead(name, options.bulkhead));
    }

    // 5. Timeout (单次下游实际调用超时)
    if (options.timeout) {
      const durationMs =
        typeof options.timeout === 'number' ? options.timeout : (options.timeout as TimeoutPolicyOptions).durationMs;
      policies.push(timeout(durationMs, TimeoutStrategy.Aggressive));
    }

    const combined = policies.length > 0 ? wrap(...policies) : noop;
    this.pipelines.set(name, combined);
    return combined;
  }

  /**
   * 获取所有注册的断路器实时运行指标统计
   */
  getStats(): Record<string, CircuitBreakerStats> {
    const stateMap: Record<CircuitState, CircuitStateName> = {
      [CircuitState.Closed]: 'CLOSED',
      [CircuitState.Open]: 'OPEN',
      [CircuitState.HalfOpen]: 'HALF_OPEN',
      [CircuitState.Isolated]: 'ISOLATED',
    };

    const stats: Record<string, CircuitBreakerStats> = {};

    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = {
        name,
        state: stateMap[breaker.state] ?? 'CLOSED',
        rawState: breaker.state,
      };
    }

    return stats;
  }

  /**
   * 获取所有出站配额限流器的运行指标概览
   */
  getRateLimiterStats(): Record<string, { name: string; driver: string; limit: number; windowMs: number }> {
    const stats: Record<string, { name: string; driver: string; limit: number; windowMs: number }> = {};
    for (const [name, limiter] of this.rateLimiters.entries()) {
      stats[name] = {
        name,
        driver: limiter.driver,
        limit: limiter.limit,
        windowMs: limiter.windowMs,
      };
    }
    return stats;
  }

  /**
   * 根据名称获取指定断路器实例（若不存在返回 undefined）
   */
  getCircuitBreaker(name: string): CircuitBreakerPolicy | undefined {
    return this.breakers.get(name);
  }

  /**
   * 测试/管理用：重置指定或全部注册状态
   */
  clear(): void {
    this.breakers.clear();
    this.bulkheads.clear();
    this.rateLimiters.clear();
    this.pipelines.clear();
  }
}

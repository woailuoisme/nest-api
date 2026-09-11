import { Logger } from '@nestjs/common';
import {
  type Event,
  EventEmitter,
  type IDefaultPolicyContext,
  type IFailureEvent,
  type IPolicy,
  type ISuccessEvent,
} from 'cockatiel';
import type Redis from 'ioredis';
import { LocalTokenBucket } from './local-token-bucket';
import { RateLimitExceededError, type RateLimitOptions } from './rate-limiter.types';

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local clearBefore = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return 1
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = oldest[2] and tonumber(oldest[2]) or now
  local retryAfterMs = (oldestScore + window) - now
  return -retryAfterMs
end
`;

export interface RedisProvider {
  getClient(): Redis;
}

/**
 * 兼容 Cockatiel 流水线标准契约的出站限流策略包装 (RateLimiterPolicy)
 */
export class RateLimiterPolicy implements IPolicy<IDefaultPolicyContext, never> {
  declare readonly _altReturn: never;
  private readonly logger = new Logger(RateLimiterPolicy.name);
  readonly name: string;
  private readonly options: Required<RateLimitOptions>;
  private readonly localBucket: LocalTokenBucket;
  private readonly redisClient?: Redis;
  private readonly listeners: Array<(error: RateLimitExceededError) => void> = [];

  private readonly successEmitter = new EventEmitter<ISuccessEvent>();
  private readonly failureEmitter = new EventEmitter<IFailureEvent>();

  readonly onSuccess: Event<ISuccessEvent> = this.successEmitter.addListener;
  readonly onFailure: Event<IFailureEvent> = this.failureEmitter.addListener;

  constructor(name: string, options: RateLimitOptions, redisProvider?: Redis | RedisProvider) {
    this.name = name;
    this.options = {
      limit: Math.max(1, options.limit),
      windowMs: Math.max(1, options.windowMs ?? 1000),
      maxWaitMs: Math.max(0, options.maxWaitMs ?? 0),
      driver: options.driver ?? 'local',
    };
    this.localBucket = new LocalTokenBucket(this.options.limit, this.options.windowMs);
    this.redisClient =
      redisProvider && 'getClient' in redisProvider && typeof redisProvider.getClient === 'function'
        ? redisProvider.getClient()
        : (redisProvider as Redis | undefined);
  }

  get limit(): number {
    return this.options.limit;
  }

  get windowMs(): number {
    return this.options.windowMs;
  }

  get maxWaitMs(): number {
    return this.options.maxWaitMs;
  }

  get driver(): string {
    return this.options.driver;
  }

  /**
   * 注册限流触发监听器
   */
  onRateLimited(listener: (error: RateLimitExceededError) => void): this {
    this.listeners.push(listener);
    return this;
  }

  private notifyRateLimited(err: RateLimitExceededError): void {
    for (const listener of this.listeners) {
      try {
        listener(err);
      } catch {
        // 防止监听器异常影响主流程
      }
    }
  }

  /**
   * 核心执行守卫：在执行目标业务函数前完成配额检查与平滑排队
   */
  async execute<T>(fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T, signal?: AbortSignal): Promise<T> {
    const start = Date.now();
    try {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Operation aborted');
      }

      if (this.options.driver === 'redis' && this.redisClient) {
        await this.acquireRedisWithFallback(signal);
      } else {
        await this.localBucket.acquire(this.options.maxWaitMs, signal);
      }

      if (signal?.aborted) {
        throw signal.reason ?? new Error('Operation aborted');
      }

      const defaultContext: IDefaultPolicyContext = {
        signal: signal ?? new AbortController().signal,
      };

      const result = await fn(defaultContext);
      this.successEmitter.emit({ duration: Date.now() - start });
      return result;
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        this.notifyRateLimited(err);
      }
      this.failureEmitter.emit({
        duration: Date.now() - start,
        handled: err instanceof RateLimitExceededError,
        reason: { error: err },
      });
      throw err;
    }
  }

  /**
   * 基于 Redis 滑动窗口原子扣减（支持安全降级）
   */
  private async acquireRedisWithFallback(signal?: AbortSignal): Promise<void> {
    try {
      await this.acquireRedis();
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        this.notifyRateLimited(err);
        throw err;
      }
      // Redis 发生网络抖动或服务不可用，降级为本地内存令牌桶保护
      this.logger.warn({
        msg: `Redis rate limiter failed for [${this.name}], falling back to local bucket`,
        error: (err as Error)?.message ?? err,
      });
      try {
        await this.localBucket.acquire(this.options.maxWaitMs, signal);
      } catch (localErr) {
        if (localErr instanceof RateLimitExceededError) {
          this.notifyRateLimited(localErr);
        }
        throw localErr;
      }
    }
  }

  private async acquireRedis(): Promise<void> {
    const client = this.redisClient;
    if (!client) return;

    const redisKey = `resilience:ratelimit:${this.name}`;
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    const res = (await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      redisKey,
      now,
      this.options.windowMs,
      this.options.limit,
      member,
    )) as number;

    if (res === 1) {
      return; // 获得配额
    }

    const waitMs = Math.max(1, -res);
    if (this.options.maxWaitMs <= 0 || waitMs > this.options.maxWaitMs) {
      throw new RateLimitExceededError(
        `Redis outbound rate limit exceeded [${this.name}]: required wait ${waitMs}ms exceeds maxWaitMs ${this.options.maxWaitMs}ms`,
        this.options.limit,
        this.options.windowMs,
        waitMs,
      );
    }

    // 在允许的 maxWaitMs 内平滑等待后重试一次
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    const retryNow = Date.now();
    const retryMember = `${retryNow}:${Math.random().toString(36).slice(2, 8)}`;

    const retryRes = (await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      redisKey,
      retryNow,
      this.options.windowMs,
      this.options.limit,
      retryMember,
    )) as number;

    if (retryRes !== 1) {
      throw new RateLimitExceededError(
        `Redis outbound rate limit exceeded [${this.name}]: quota exhausted after queueing`,
        this.options.limit,
        this.options.windowMs,
        waitMs,
      );
    }
  }
}

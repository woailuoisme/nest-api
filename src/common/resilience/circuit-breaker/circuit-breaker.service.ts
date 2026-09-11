import { Injectable, Logger } from '@nestjs/common';
import type { CircuitBreakerPolicy, IPolicy } from 'cockatiel';
import type { CircuitBreakerOptions, CircuitBreakerStats, ResilientOptions } from './circuit-breaker.types';
import { ResilienceRegistryService } from './resilience-registry.service';

/**
 * 出站弹性治理管理服务 (CircuitBreaker / Resilience Service)
 *
 * 维护系统内部所有命名策略的全局生命周期，提供编程式韧性调用（重试、熔断、仓壁、超时与降级容灾）及指标汇总。
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(private readonly registry: ResilienceRegistryService) {}

  /**
   * 获取或初始化指定名称的断路器单例
   */
  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreakerPolicy {
    return this.registry.getOrCreateCircuitBreaker(name, options);
  }

  /**
   * 获取或初始化指定名称的组合策略流水线
   */
  getPipeline(name: string, options: ResilientOptions = {}): IPolicy {
    return this.registry.getOrCreatePipeline(name, options);
  }

  /**
   * 编程式执行受弹性策略（重试/熔断/仓壁/超时）保护的异步调用，并支持优雅降级回退 (Fallback)
   *
   * @param name 策略唯一命名空间
   * @param action 受保护的真实异步业务闭包
   * @param options 策略配置（支持 circuitBreaker, retry, bulkhead, timeout, fallback）
   */
  async execute<T>(name: string, action: () => Promise<T>, options?: ResilientOptions<T>): Promise<T> {
    const pipeline = this.registry.getOrCreatePipeline(name, options ?? {});

    try {
      return await pipeline.execute(action);
    } catch (error) {
      if (options?.fallback) {
        this.logger.warn({
          msg: `Invoking fallback for resilience pipeline [${name}]`,
          error: (error as Error)?.message ?? error,
        });

        if (typeof options.fallback === 'function') {
          return (await options.fallback(error)) as T;
        }
      }
      throw error;
    }
  }

  /**
   * 获取所有（或指定）断路器的当前实时监控统计
   */
  getStats(name?: string): CircuitBreakerStats[] | CircuitBreakerStats | undefined {
    const allStats = this.registry.getStats();
    if (name) {
      return allStats[name];
    }
    return Object.values(allStats);
  }

  /**
   * 清理或重置策略缓存
   */
  reset(): void {
    this.registry.clear();
  }
}

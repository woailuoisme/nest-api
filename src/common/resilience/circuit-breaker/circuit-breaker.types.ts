import { CircuitState } from 'cockatiel';

import { TrafficPriority } from '../load-shedding/load-shedding.constants';
import type { RateLimitOptions } from '../rate-limiter/rate-limiter.types';

export { CircuitState, type RateLimitOptions, TrafficPriority };

/** 人类可读的断路器状态名称 */
export type CircuitStateName = 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'ISOLATED';

/**
 * 重试策略配置选项 (Retry Policy)
 */
export interface RetryOptions {
  /** 最大重试次数（默认：3 次） */
  attempts?: number;
  /** 退避算法类型：exponential (指数退避带抖动) 或 constant (固定延时)，默认：exponential */
  backoff?: 'exponential' | 'constant';
  /** 初始重试延迟（毫秒，默认：500ms） */
  initialDelayMs?: number;
  /** 最大重试延迟上限（毫秒，默认：5000ms） */
  maxDelayMs?: number;
  /** 是否启用随机抖动 Jitter 防惊群效应（默认：true） */
  jitter?: boolean;
}

/**
 * 断路器配置选项 (Circuit Breaker Policy)
 */
export interface CircuitBreakerOptions<T = unknown> {
  /** 断路器命名空间（默认自动推断） */
  name?: string;
  /** 熔断冷却恢复时间（毫秒，默认：10,000ms） */
  halfOpenAfterMs?: number;
  /** 别名兼容：旧版 resetTimeoutMs 映射至 halfOpenAfterMs */
  resetTimeoutMs?: number;
  /** 触发跳闸的连续失败次数阈值（默认：5） */
  consecutiveFailures?: number;
  /** 别名兼容：旧版 failureThreshold 映射至 consecutiveFailures */
  failureThreshold?: number;
  /**
   * 基于统计窗口的高级采样率熔断（可选）
   * 例如：在 10s 内请求数不少于 10 次且错误率达到 50% 时跳闸
   */
  sampling?: {
    durationMs: number;
    /**
     * 采样周期内触发熔断的失败率阈值，取值范围为 0.0 ~ 1.0（即 0% ~ 100%）
     * @example 0.5 // 失败率达到 50% 时跳闸
     */
    failureRatio: number;
    minimumRps?: number;
  };
  /** 发生熔断或调用失败时的优雅降级回调函数或类方法名 */
  fallback?: string | ((error: unknown, ...args: unknown[]) => T | Promise<T>);
}

/**
 * 仓壁隔离配置选项 (Bulkhead Policy)
 */
export interface BulkheadOptions {
  /** 最大允许的并发执行数 */
  maxConcurrent: number;
  /** 排队等待执行的队列容量上限（默认：0，无可用槽位时立即快速失败） */
  maxQueue?: number;
}

/**
 * 超时策略配置选项 (Timeout Policy)
 */
export interface TimeoutPolicyOptions {
  /** 单次下游调用超时阈值（毫秒） */
  durationMs: number;
}

/**
 * 复合弹性治理调用配置 (Resilience Pipeline Options)
 */
export interface ResilientOptions<T = unknown> {
  /** 策略唯一命名标识 */
  name?: string;
  /** 断路器策略配置（传 true 使用默认配置，false 禁用） */
  circuitBreaker?: boolean | CircuitBreakerOptions;
  /** 出站客户端配额限流配置（Token Bucket / 滑动窗口） */
  rateLimit?: RateLimitOptions;
  /** 重试策略配置（传 true 使用默认配置，false 禁用） */
  retry?: boolean | RetryOptions;
  /** 仓壁并发隔离配置 */
  bulkhead?: BulkheadOptions;
  /** 单次调用超时策略配置（毫秒或完整选项） */
  timeout?: number | TimeoutPolicyOptions;
  /**
   * 运行时系统过载协同短路脱落 (In-Service Load-Shedding)
   * 若配置为指定 TrafficPriority（或 true 即 DEFAULT），方法在执行前预检本地 Node 进程负载水位。
   * 若当前已过载，则立刻短路跳入 fallback，杜绝进程濒临崩溃时依然发起下游网络 I/O 与耗时重试。
   */
  shedIfOverloaded?: TrafficPriority | boolean;
  /**
   * 客户端取消 / 网关中断取消信号 (AbortSignal)
   * 可通过配置显式指定，或由 @Resilient() 自动从方法实参中嗅探。
   * 用于在调用取消时快速短路并中断重试、限流排队与下游执行，避免算力浪费与重试风暴。
   */
  signal?: AbortSignal;
  /**
   * 优雅降级回调函数或当前类内部方法名
   * 当捕获到重试耗尽、熔断跳闸 (BrokenCircuitError)、限流超额 (RateLimitExceededError)、仓壁超载 (BulkheadRejectedError) 或超时错误时调用
   */
  fallback?: string | ((error: unknown, ...args: unknown[]) => T | Promise<T>);
}

/**
 * 断路器实时运行指标统计
 */
export interface CircuitBreakerStats {
  name: string;
  state: CircuitStateName;
  rawState: CircuitState;
}

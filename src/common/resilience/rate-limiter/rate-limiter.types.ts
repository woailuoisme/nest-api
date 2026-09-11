/**
 * 出站客户端限流错误
 */
export class RateLimitExceededError extends Error {
  readonly limit: number;
  readonly windowMs: number;
  readonly waitMs?: number;

  constructor(message: string, limit: number, windowMs: number, waitMs?: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.limit = limit;
    this.windowMs = windowMs;
    this.waitMs = waitMs;
    Object.setPrototypeOf(this, RateLimitExceededError.prototype);
  }

  get retryAfterMs(): number | undefined {
    return this.waitMs;
  }
}

/**
 * 出站限流作用域驱动
 * - 'local': 单机进程内高性能令牌桶（默认，零网络开销）
 * - 'redis': 基于 Redis 滑动窗口在多 Pod 集群中强一致共享配额
 */
export type RateLimitDriver = 'local' | 'redis';

/**
 * 出站客户端配额限流配置选项
 */
export interface RateLimitOptions {
  /** 时间窗口内允许的最大调用次数 / 令牌上限（如 100） */
  limit: number;
  /** 统计时间窗口大小（毫秒，默认：1000ms，即 1 秒） */
  windowMs?: number;
  /**
   * 令牌耗尽时的最大平滑排队等待时间（毫秒，默认：0 表示不等待，立即快速失败）
   * 推荐配置：如 1000~3000ms，可在突发短时洪峰下平滑流量，防止因毫秒级抖动触发限流
   */
  maxWaitMs?: number;
  /**
   * 限流存储驱动（默认：'local'）
   */
  driver?: RateLimitDriver;
}

/**
 * 校验是否属于出站限流错误
 */
export function isRateLimitExceededError(error: unknown): error is RateLimitExceededError {
  return error instanceof RateLimitExceededError || (error as Error)?.name === 'RateLimitExceededError';
}

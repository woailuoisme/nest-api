import { RateLimitExceededError } from './rate-limiter.types';

/**
 * 本地高性能内存令牌桶 (Local Token Bucket)
 *
 * 采用惰性补充 (Lazy Refill) 算法，零后台定时器开销，
 * 支持流量整形 (Traffic Shaping) 与毫秒级平滑排队等待。
 */
export class LocalTokenBucket {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly fillRate: number; // 令牌/毫秒
  private tokens: number;
  private lastRefillTime: number;

  constructor(limit: number, windowMs = 1000) {
    this.limit = Math.max(1, limit);
    this.windowMs = Math.max(1, windowMs);
    this.fillRate = this.limit / this.windowMs;
    this.tokens = this.limit;
    this.lastRefillTime = Date.now();
  }

  /**
   * 惰性计算并回补令牌
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    if (elapsed > 0) {
      this.tokens = Math.min(this.limit, this.tokens + elapsed * this.fillRate);
      this.lastRefillTime = now;
    }
  }

  /**
   * 尝试获取一个令牌（支持平滑等待排队与取消信号监听）
   *
   * @param maxWaitMs 允许的最大排队等待时间（毫秒）
   * @param signal 可选的 AbortSignal 取消信号
   * @throws {RateLimitExceededError} 当令牌不足且所需等待时间超过 maxWaitMs 时抛出
   */
  async acquire(maxWaitMs = 0, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Operation aborted');
    }

    this.refill();

    // 1. 桶中有可用令牌，立即放行
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // 2. 桶已耗尽，且配置为快速失败（不等待）
    if (maxWaitMs <= 0) {
      const needed = 1 - this.tokens;
      const waitMs = Math.max(1, Math.ceil(needed / this.fillRate));
      throw new RateLimitExceededError(
        `Outbound rate limit exceeded [${this.limit}/${this.windowMs}ms]: 0 tokens available`,
        this.limit,
        this.windowMs,
        waitMs,
      );
    }

    // 3. 计算回补至少 1 个令牌所需的毫秒数
    const needed = 1 - this.tokens;
    const waitMs = Math.ceil(needed / this.fillRate);

    // 4. 若所需等待时间超出调用方允许的上限，快速失败
    if (waitMs > maxWaitMs) {
      throw new RateLimitExceededError(
        `Outbound rate limit exceeded [${this.limit}/${this.windowMs}ms]: required wait ${waitMs}ms exceeds maxWaitMs ${maxWaitMs}ms`,
        this.limit,
        this.windowMs,
        waitMs,
      );
    }

    // 5. 在允许窗口内平滑等待并预占令牌（支持 AbortSignal 提前短路）
    this.tokens -= 1;
    if (!signal) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    } else {
      await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;
        const onAbort = () => {
          if (timer) {
            clearTimeout(timer);
          }
          signal.removeEventListener('abort', onAbort);
          // 若排队取消，回补预占的令牌以防额度泄漏
          this.tokens = Math.min(this.limit, this.tokens + 1);
          reject(signal.reason ?? new Error('Operation aborted'));
        };

        timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, waitMs);

        signal.addEventListener('abort', onAbort);
      });
    }

    this.refill();
  }

  /**
   * 当前可用令牌估计数（用于监控与探针）
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.max(0, Math.floor(this.tokens));
  }

  get availableTokens(): number {
    return this.getAvailableTokens();
  }
}

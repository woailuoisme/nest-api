/**
 * 截止时间超时预算耗尽错误 (Deadline Budget Exceeded)
 *
 * 当请求全链路剩余时间不足以发起下游 RPC / 网络 I/O (如剩余时间 <= 50ms) 时，
 * 由 @Resilient() 预检拦截并主动抛出，防止雪崩并在客户端超时前及早释放计算与连接资源。
 */
export class DeadlineExceededError extends Error {
  readonly remainingMs: number;
  readonly minBudgetMs: number;

  constructor(message: string, remainingMs: number, minBudgetMs = 50) {
    super(message);
    this.name = 'DeadlineExceededError';
    this.remainingMs = remainingMs;
    this.minBudgetMs = minBudgetMs;
    Object.setPrototypeOf(this, DeadlineExceededError.prototype);
  }
}

/**
 * 校验是否属于截止时间超时预算耗尽错误
 */
export function isDeadlineExceededError(error: unknown): error is DeadlineExceededError {
  return error instanceof DeadlineExceededError || (error as Error)?.name === 'DeadlineExceededError';
}

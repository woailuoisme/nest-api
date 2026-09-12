export * from './bulkhead-rejected.exception.js';
export * from './circuit-opened.exception.js';
export * from './health-check-failed.exception.js';
export * from './load-shed.exception.js';
export * from './resilience-runtime.exception.js';
export * from './throttler.exception.js';
export * from './timeout.exception.js';

import { BulkheadRejectedException } from './bulkhead-rejected.exception.js';
import { CircuitOpenedException } from './circuit-opened.exception.js';
import { LoadShedException } from './load-shed.exception.js';
import { ResilienceRuntimeException } from './resilience-runtime.exception.js';
import { ThrottlerException } from './throttler.exception.js';
import { TimeoutException } from './timeout.exception.js';

/**
 * 熔断器开启异常兼容别名 (BrokenCircuitError)
 */
export class BrokenCircuitError extends CircuitOpenedException {
  constructor(message = 'Circuit is open') {
    super();
    this.name = 'BrokenCircuitError';
    this.message = message;
    Object.setPrototypeOf(this, BrokenCircuitError.prototype);
  }
}

/**
 * 仓壁隔离超出容量异常兼容别名 (BulkheadRejectedError)
 */
export class BulkheadRejectedError extends BulkheadRejectedException {
  constructor(message = 'Bulkhead capacity exceeded', executionSlots = 0, queueSlots = 0) {
    super(executionSlots, queueSlots);
    this.name = 'BulkheadRejectedError';
    this.message = message;
    Object.setPrototypeOf(this, BulkheadRejectedError.prototype);
  }
}

/**
 * 超时异常兼容别名 (TimeoutError / ResilienceTimeoutError)
 */
export class TimeoutError extends TimeoutException {
  constructor(timeout = 0) {
    super(timeout);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export { TimeoutError as ResilienceTimeoutError };

/**
 * 截止时间超时预算耗尽异常 (DeadlineExceededError)
 */
export class DeadlineExceededError extends TimeoutException {
  readonly remainingMs: number;
  readonly minBudgetMs: number;

  constructor(message: string, remainingMs = 0, minBudgetMs = 50) {
    super(remainingMs);
    this.name = 'DeadlineExceededError';
    this.message = message;
    this.remainingMs = remainingMs;
    this.minBudgetMs = minBudgetMs;
    Object.setPrototypeOf(this, DeadlineExceededError.prototype);
  }
}

/**
 * 任务取消异常 (TaskCancelledError)
 */
export class TaskCancelledError extends ResilienceRuntimeException {
  constructor(message = 'Task was cancelled') {
    super(message);
    this.name = 'TaskCancelledError';
    Object.setPrototypeOf(this, TaskCancelledError.prototype);
  }
}

/**
 * 配额超限异常兼容别名 (RateLimitExceededError)
 */
export class RateLimitExceededError extends ThrottlerException {
  readonly retryAfterMs?: number;

  constructor(message = 'Rate limit exceeded', retryAfterMs?: number) {
    super();
    this.name = 'RateLimitExceededError';
    this.message = message;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, RateLimitExceededError.prototype);
  }
}

// ================= 类型保护工具函数 =================

export function isBrokenCircuitError(error: unknown): error is CircuitOpenedException {
  return (
    error instanceof CircuitOpenedException ||
    (error as Error)?.name === 'BrokenCircuitError' ||
    (error as Error)?.name === 'CircuitOpenedException'
  );
}

export function isBulkheadRejectedError(error: unknown): error is BulkheadRejectedException {
  return (
    error instanceof BulkheadRejectedException ||
    (error as Error)?.name === 'BulkheadRejectedError' ||
    (error as Error)?.name === 'BulkheadRejectedException'
  );
}

export function isTimeoutError(error: unknown): error is TimeoutException {
  return (
    error instanceof TimeoutException ||
    (error as Error)?.name === 'TimeoutError' ||
    (error as Error)?.name === 'TimeoutException'
  );
}

export function isDeadlineExceededError(error: unknown): error is DeadlineExceededError {
  return error instanceof DeadlineExceededError || (error as Error)?.name === 'DeadlineExceededError';
}

export function isTaskCancelledError(error: unknown): error is TaskCancelledError {
  return error instanceof TaskCancelledError || (error as Error)?.name === 'TaskCancelledError';
}

export function isRateLimitExceededError(error: unknown): error is ThrottlerException {
  return (
    error instanceof ThrottlerException ||
    (error as Error)?.name === 'RateLimitExceededError' ||
    (error as Error)?.name === 'ThrottlerException'
  );
}

export function isLoadShedError(error: unknown): error is LoadShedException {
  return error instanceof LoadShedException || (error as Error)?.name === 'LoadShedException';
}

import { TrafficPriority } from '../enum/index.js';
import { calculateJitteredRetryAfter } from '../utils/index.js';
import { ResilienceRuntimeException } from './resilience-runtime.exception.js';

export class LoadShedException extends ResilienceRuntimeException {
  public readonly priority: TrafficPriority;
  public readonly reason: string;
  public readonly retryAfterSeconds: number;

  public constructor(
    priority: TrafficPriority = TrafficPriority.DEFAULT,
    reason = 'System is currently overloaded, shedding traffic to protect stability',
    retryAfterSeconds?: number,
  ) {
    super(`System overload: request shed [Priority: ${priority}]. Reason: ${reason}`);
    this.priority = priority;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds ?? calculateJitteredRetryAfter();
  }
}

import type { BaseCommand } from '../commands/index.js';
import type { CircuitBreakerStatus, ResilienceEventType, TrafficPriority } from '../enum/index.js';

export interface ResilienceEvents {
  [ResilienceEventType.Emit]: [command: BaseCommand];
  [ResilienceEventType.Success]: [command: BaseCommand];
  [ResilienceEventType.Failure]: [command: BaseCommand];
  [ResilienceEventType.Timeout]: [command: BaseCommand];
  [ResilienceEventType.ShortCircuit]: [command: BaseCommand];
  [ResilienceEventType.CircuitBreakerStateChanged]: [
    command: BaseCommand | string | undefined,
    fromState: CircuitBreakerStatus,
    toState: CircuitBreakerStatus,
    reason?: string,
  ];
  [ResilienceEventType.RetryAttempt]: [
    command: BaseCommand | string | undefined,
    attempt: number,
    delayMs: number,
    error: unknown,
  ];
  [ResilienceEventType.BulkheadRejected]: [
    command: BaseCommand | string | undefined,
    activeCalls: number,
    maxConcurrent: number,
  ];
  [ResilienceEventType.LoadShedDrop]: [
    command: BaseCommand | string | undefined,
    priority: TrafficPriority,
    reason?: string,
  ];
}

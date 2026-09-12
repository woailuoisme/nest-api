import { performance } from 'node:perf_hooks';
import { catchError, finalize, from, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { BaseCommand } from '../commands/index.js';
import { CircuitBreakerStatus, ResilienceEventType } from '../enum/index.js';
import { CircuitOpenedException } from '../exceptions/index.js';
import { CircuitBreakerOptions } from '../interfaces/index.js';
import { ResilienceEventBus } from '../resilience.event-bus.js';
import { ResilienceStatesManager } from '../resilience.states-manager.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import { Strategy } from './base.strategy.js';
import { CacheStrategy } from './cache.strategy.js';
import { TimeoutStrategy } from './timeout.strategy.js';

interface CallRecord {
  success: boolean;
  durationMs: number;
  slow: boolean;
}

interface CircuitBreakerState {
  status: CircuitBreakerStatus;
  openedAt: number;
  halfOpenAttempts: number;
  halfOpenSuccesses: number;
}

export class CircuitBreakerStrategy extends Strategy<CircuitBreakerOptions> {
  public static readonly PRIORITY = 600;
  public override readonly executionPriority = CircuitBreakerStrategy.PRIORITY;

  private static readonly DEFAULT_OPTIONS: Required<
    Pick<
      CircuitBreakerOptions,
      | 'slidingWindowSize'
      | 'minimumNumberOfCalls'
      | 'failureRateThreshold'
      | 'sleepWindowInMilliseconds'
      | 'permittedNumberOfCallsInHalfOpenState'
      | 'successThresholdInHalfOpenState'
    >
  > = {
    slidingWindowSize: 100,
    minimumNumberOfCalls: 10,
    failureRateThreshold: 50,
    sleepWindowInMilliseconds: 5000,
    permittedNumberOfCallsInHalfOpenState: 5,
    successThresholdInHalfOpenState: 3,
  };

  private static readonly activeStrategies = new Set<CircuitBreakerStrategy>();

  public static getStats(): Array<{
    name: string;
    status: CircuitBreakerStatus;
    stateName: string;
    failureRate: number;
    totalCalls: number;
  }> {
    return Array.from(CircuitBreakerStrategy.activeStrategies).map((s) => {
      const metrics = s.getMetrics();
      return {
        name: s.circuitName,
        status: s._lastStatus,
        stateName: s.stateName,
        failureRate: metrics.failureRate,
        totalCalls: metrics.totalCalls,
      };
    });
  }

  private readonly instanceId = Math.random().toString(36).slice(2, 9);
  private _lastStatus: CircuitBreakerStatus = CircuitBreakerStatus.Closed;
  private readonly ringBuffer: RingBuffer<CallRecord>;
  private readonly eventBus = ResilienceEventBus.getInstance();

  private readonly cacheStrategy = new CacheStrategy(this.options.cachedTimeoutInMilliseconds);
  private readonly timeoutStrategy = new TimeoutStrategy(this.options.timeoutInMilliseconds);

  public constructor(options?: CircuitBreakerOptions) {
    const sleepWindow =
      options?.sleepWindowInMilliseconds ??
      options?.halfOpenAfterMs ??
      options?.resetTimeoutMs ??
      CircuitBreakerStrategy.DEFAULT_OPTIONS.sleepWindowInMilliseconds;

    const minCalls =
      options?.minimumNumberOfCalls ??
      options?.requestVolumeThreshold ??
      options?.consecutiveFailures ??
      options?.failureThreshold ??
      CircuitBreakerStrategy.DEFAULT_OPTIONS.minimumNumberOfCalls;

    const failureRate =
      options?.failureRateThreshold ??
      options?.errorThresholdPercentage ??
      (options?.consecutiveFailures || options?.failureThreshold
        ? 100
        : CircuitBreakerStrategy.DEFAULT_OPTIONS.failureRateThreshold);

    const windowSize =
      options?.slidingWindowSize ??
      options?.rollingWindowInMilliseconds ??
      CircuitBreakerStrategy.DEFAULT_OPTIONS.slidingWindowSize;

    const permittedHalfOpen =
      options?.permittedNumberOfCallsInHalfOpenState ??
      CircuitBreakerStrategy.DEFAULT_OPTIONS.permittedNumberOfCallsInHalfOpenState;

    const successHalfOpen =
      options?.successThresholdInHalfOpenState ??
      CircuitBreakerStrategy.DEFAULT_OPTIONS.successThresholdInHalfOpenState;

    super({
      ...CircuitBreakerStrategy.DEFAULT_OPTIONS,
      ...options,
      slidingWindowSize: Math.max(minCalls, windowSize),
      minimumNumberOfCalls: minCalls,
      failureRateThreshold: failureRate,
      sleepWindowInMilliseconds: sleepWindow,
      permittedNumberOfCallsInHalfOpenState: permittedHalfOpen,
      successThresholdInHalfOpenState: successHalfOpen,
      // Compatibility aliases
      requestVolumeThreshold: minCalls,
      errorThresholdPercentage: failureRate,
    });

    this.ringBuffer = new RingBuffer<CallRecord>(this.options.slidingWindowSize ?? 100);
    CircuitBreakerStrategy.activeStrategies.add(this);
  }

  public get circuitName(): string {
    return this.options.name ?? this.name;
  }

  public get status(): CircuitBreakerStatus {
    return this._lastStatus;
  }

  public get state(): number {
    switch (this._lastStatus) {
      case CircuitBreakerStatus.Open:
        return 1;
      case CircuitBreakerStatus.HalfOpen:
        return 2;
      default:
        return 0;
    }
  }

  public get stateName(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'ISOLATED' {
    switch (this._lastStatus) {
      case CircuitBreakerStatus.Open:
        return 'OPEN';
      case CircuitBreakerStatus.HalfOpen:
        return 'HALF_OPEN';
      default:
        return 'CLOSED';
    }
  }

  public reset(): void {
    const oldStatus = this._lastStatus;
    this._lastStatus = CircuitBreakerStatus.Closed;
    this.ringBuffer.clear();
    const statesManager = ResilienceStatesManager.getInstance();
    void statesManager.del([this.circuitName, this.instanceId].join('/'));
    if (oldStatus !== CircuitBreakerStatus.Closed) {
      this.eventBus.emit(
        ResilienceEventType.CircuitBreakerStateChanged,
        this.circuitName,
        oldStatus,
        CircuitBreakerStatus.Closed,
        'Manual reset',
      );
    }
  }

  public getMetrics(): {
    totalCalls: number;
    failedCalls: number;
    successfulCalls: number;
    slowCalls: number;
    failureRate: number;
    slowCallRate: number;
  } {
    const total = this.ringBuffer.size();
    if (total === 0) {
      return { totalCalls: 0, failedCalls: 0, successfulCalls: 0, slowCalls: 0, failureRate: 0, slowCallRate: 0 };
    }

    let failed = 0;
    let slow = 0;
    this.ringBuffer.reduce((_, record) => {
      if (!record.success) failed += 1;
      if (record.slow) slow += 1;
      return null;
    }, null);

    const successful = total - failed;
    const failureRate = Math.round((failed / total) * 100);
    const slowCallRate = Math.round((slow / total) * 100);

    return {
      totalCalls: total,
      failedCalls: failed,
      successfulCalls: successful,
      slowCalls: slow,
      failureRate,
      slowCallRate,
    };
  }

  public process<T>(observable: Observable<T>, command?: BaseCommand, ...args: unknown[]): Observable<T> {
    const statesManager = ResilienceStatesManager.getInstance();
    const key = [this.circuitName, command?.toString() ?? this.instanceId].join('/');

    const minCalls = this.options.minimumNumberOfCalls ?? 10;
    const failureRateThreshold = this.options.failureRateThreshold ?? 50;
    const sleepWindow = this.options.sleepWindowInMilliseconds ?? 5000;
    const permittedHalfOpen = this.options.permittedNumberOfCallsInHalfOpenState ?? 5;
    const successHalfOpen = this.options.successThresholdInHalfOpenState ?? 3;
    const slowCallThresholdMs = this.options.slowCallDurationThresholdMs;
    const slowCallRateThreshold = this.options.slowCallRateThreshold;

    const state$ = from(
      statesManager.wrap<CircuitBreakerState>(key, async () => ({
        status: CircuitBreakerStatus.Closed,
        openedAt: 0,
        halfOpenAttempts: 0,
        halfOpenSuccesses: 0,
      })),
    );

    return state$.pipe(
      switchMap((state) => {
        const isOpen = state.status === CircuitBreakerStatus.Open;

        // 1. OPEN 状态超时检测与向 HALF_OPEN 跃迁
        if (isOpen) {
          if (Date.now() < state.openedAt + sleepWindow) {
            this._lastStatus = state.status;
            return this.getFallbackOrThrowError(new CircuitOpenedException());
          }

          // 跃迁到 HALF_OPEN
          const fromState = state.status;
          state.status = CircuitBreakerStatus.HalfOpen;
          state.halfOpenAttempts = 0;
          state.halfOpenSuccesses = 0;
          this._lastStatus = state.status;
          this.eventBus.emit(
            ResilienceEventType.CircuitBreakerStateChanged,
            command ?? this.circuitName,
            fromState,
            state.status,
            'Sleep window elapsed',
          );
        }

        // 2. HALF_OPEN 试探限流
        if (state.status === CircuitBreakerStatus.HalfOpen) {
          if (state.halfOpenAttempts >= permittedHalfOpen) {
            return this.getFallbackOrThrowError(new CircuitOpenedException());
          }
          state.halfOpenAttempts += 1;
        }

        // 3. 包装内联 Cache 与 Timeout
        let targetObservable = observable;
        if (this.options.cachedTimeoutInMilliseconds) {
          targetObservable = this.cacheStrategy.process(targetObservable, command, ...args);
        }
        if (this.options.timeoutInMilliseconds) {
          targetObservable = this.timeoutStrategy.process(targetObservable);
        }

        const startTime = performance.now();

        return targetObservable.pipe(
          tap(() => {
            const durationMs = performance.now() - startTime;
            const isSlow = Boolean(slowCallThresholdMs && durationMs >= slowCallThresholdMs);

            if (state.status === CircuitBreakerStatus.HalfOpen) {
              state.halfOpenSuccesses += 1;
              if (state.halfOpenSuccesses >= successHalfOpen) {
                // 成功恢复为 CLOSED
                const fromState = state.status;
                state.status = CircuitBreakerStatus.Closed;
                state.halfOpenAttempts = 0;
                state.halfOpenSuccesses = 0;
                this.ringBuffer.clear();
                this._lastStatus = state.status;
                this.eventBus.emit(
                  ResilienceEventType.CircuitBreakerStateChanged,
                  command ?? this.circuitName,
                  fromState,
                  state.status,
                  'Half-open trials succeeded',
                );
              }
            } else if (state.status === CircuitBreakerStatus.Closed) {
              this.ringBuffer.push({ success: true, durationMs, slow: isSlow });
              this.checkAndTriggerSlowCallOpen(state, command);
            }
          }),
          finalize(async () => {
            this._lastStatus = state.status;
            await statesManager.set(key, state);
          }),
          catchError((error) => {
            const durationMs = performance.now() - startTime;

            if (state.status === CircuitBreakerStatus.HalfOpen) {
              // 半开试探失败，立即重新进入 OPEN
              const fromState = state.status;
              state.status = CircuitBreakerStatus.Open;
              state.openedAt = Date.now();
              state.halfOpenAttempts = 0;
              state.halfOpenSuccesses = 0;
              this._lastStatus = state.status;
              this.eventBus.emit(
                ResilienceEventType.CircuitBreakerStateChanged,
                command ?? this.circuitName,
                fromState,
                state.status,
                'Half-open trial call failed',
              );
            } else if (state.status === CircuitBreakerStatus.Closed) {
              this.ringBuffer.push({ success: false, durationMs, slow: false });
              const metrics = this.getMetrics();

              // 达到最小采样数量时计算失败率
              if (metrics.totalCalls >= minCalls) {
                const failureOver = metrics.failureRate >= failureRateThreshold;
                const slowOver = slowCallRateThreshold && metrics.slowCallRate >= slowCallRateThreshold;

                if (failureOver || slowOver) {
                  const fromState = state.status;
                  state.status = CircuitBreakerStatus.Open;
                  state.openedAt = Date.now();
                  this._lastStatus = state.status;
                  const reason = failureOver
                    ? `Failure rate ${metrics.failureRate.toFixed(1)}% >= threshold ${failureRateThreshold}%`
                    : `Slow call rate ${metrics.slowCallRate.toFixed(1)}% >= threshold ${slowCallRateThreshold}%`;
                  this.eventBus.emit(
                    ResilienceEventType.CircuitBreakerStateChanged,
                    command ?? this.circuitName,
                    fromState,
                    state.status,
                    reason,
                  );
                }
              }
            }

            this._lastStatus = state.status;
            return this.getFallbackOrThrowError(error);
          }),
        );
      }),
    ) as Observable<T>;
  }

  private checkAndTriggerSlowCallOpen(state: CircuitBreakerState, command?: BaseCommand): void {
    const minCalls = this.options.minimumNumberOfCalls ?? 10;
    const slowRateThreshold = this.options.slowCallRateThreshold;
    if (!slowRateThreshold) return;

    const metrics = this.getMetrics();
    if (metrics.totalCalls >= minCalls && metrics.slowCallRate >= slowRateThreshold) {
      const fromState = state.status;
      state.status = CircuitBreakerStatus.Open;
      state.openedAt = Date.now();
      this._lastStatus = state.status;
      this.eventBus.emit(
        ResilienceEventType.CircuitBreakerStateChanged,
        command ?? this.circuitName,
        fromState,
        state.status,
        `Slow call rate ${metrics.slowCallRate.toFixed(1)}% >= threshold ${slowRateThreshold}%`,
      );
    }
  }

  private getFallbackOrThrowError<T>(error: Error): Observable<T> {
    if (typeof this.options.fallback === 'function') {
      return of(this.options.fallback(error) as T);
    }
    if (this.options.fallback !== undefined) {
      return of(this.options.fallback as unknown as T);
    }

    return throwError(() => error);
  }
}

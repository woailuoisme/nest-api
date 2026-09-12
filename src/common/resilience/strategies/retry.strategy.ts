import { Observable, retry, timer } from 'rxjs';
import { BaseCommand } from '../commands/index.js';
import { ResilienceEventType } from '../enum/index.js';
import { Backoff, DecorrelatedJitterBackoff, ExponentialBackoff, FixedBackoff } from '../helpers/index.js';
import { RetryOptions } from '../interfaces/index.js';
import { ResilienceEventBus } from '../resilience.event-bus.js';
import { Strategy } from './base.strategy.js';

export class RetryStrategy extends Strategy<RetryOptions> {
  public static readonly PRIORITY = 700;
  public override readonly executionPriority = RetryStrategy.PRIORITY;

  private static readonly DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 5,
    maxDelay: 30000,
    scaleFactor: 1,
    backoff: FixedBackoff,
    retryable: () => true,
  };

  private get backoff(): Backoff {
    if (this.options.backoff instanceof Backoff) {
      return this.options.backoff;
    }

    if (typeof this.options.backoff === 'function') {
      const BackoffClass = this.options.backoff as new () => Backoff;
      return new BackoffClass();
    }

    return new FixedBackoff();
  }

  public constructor(options: RetryOptions = {}) {
    let resolvedBackoff = options.backoff;
    if (resolvedBackoff === 'exponential') {
      resolvedBackoff = options.jitter ? DecorrelatedJitterBackoff : ExponentialBackoff;
    } else if (resolvedBackoff === 'constant') {
      resolvedBackoff = FixedBackoff;
    }

    const retries = options.maxRetries ?? options.attempts ?? RetryStrategy.DEFAULT_OPTIONS.maxRetries;
    const scale = options.scaleFactor ?? options.initialDelayMs ?? RetryStrategy.DEFAULT_OPTIONS.scaleFactor;
    const maxDelay = options.maxDelay ?? options.maxDelayMs ?? RetryStrategy.DEFAULT_OPTIONS.maxDelay;

    super({
      ...RetryStrategy.DEFAULT_OPTIONS,
      ...options,
      maxRetries: retries,
      scaleFactor: scale,
      maxDelay,
      backoff: resolvedBackoff ?? RetryStrategy.DEFAULT_OPTIONS.backoff,
    });

    const scaleFactor = this.options.scaleFactor ?? 1;
    if (scaleFactor <= 0) {
      throw new RangeError(`Scale factor must be greater than 0, got: ${scaleFactor}`);
    }
  }

  public process<T>(observable: Observable<T>, command?: BaseCommand): Observable<T> {
    const maxRetries = this.options.maxRetries ?? 5;
    const generator = this.backoff.getGenerator(maxRetries);
    let attempt = 0;

    return observable.pipe(
      retry({
        count: this.options.maxRetries,
        delay: (error) => {
          const isRetryable = this.options.retryable ?? (() => true);
          if (!isRetryable(error)) {
            throw error;
          }

          const { value, done } = generator.next();

          if (done) {
            throw error;
          }

          attempt++;
          const scaleFactor = this.options.scaleFactor ?? 1;
          const maxDelay = this.options.maxDelay ?? 30000;
          const delay = value * scaleFactor;
          const finalDelay = Math.max(0, Math.min(delay, maxDelay));

          ResilienceEventBus.getInstance().emit(ResilienceEventType.RetryAttempt, command, attempt, finalDelay, error);

          return timer(finalDelay);
        },
      }),
    );
  }
}

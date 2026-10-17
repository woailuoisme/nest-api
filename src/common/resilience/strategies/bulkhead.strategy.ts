import { finalize, Observable, Subject, throwError } from 'rxjs';

import { BaseCommand } from '../commands/index.js';
import { ResilienceEventType } from '../enum/index.js';
import { BulkheadRejectedException } from '../exceptions/index.js';
import { BulkheadOptions } from '../interfaces/index.js';
import { ResilienceEventBus } from '../resilience.event-bus.js';
import { Strategy } from './base.strategy.js';

export class BulkheadStrategy extends Strategy<BulkheadOptions> {
  public static readonly PRIORITY = 500;
  public override readonly executionPriority = BulkheadStrategy.PRIORITY;

  private static readonly DEFAULT_OPTIONS: BulkheadOptions = {
    maxConcurrent: 1,
    maxQueue: 1,
  };

  private active = 0;

  private queue: Observable<unknown>[] = [];

  private queue$ = new Subject<Observable<unknown>>();

  public get executionSlots(): number {
    return (this.options.maxConcurrent ?? BulkheadStrategy.DEFAULT_OPTIONS.maxConcurrent ?? 1) - this.active;
  }

  public get queueSlots(): number {
    return (this.options.maxQueue ?? BulkheadStrategy.DEFAULT_OPTIONS.maxQueue ?? 1) - this.queue.length;
  }

  public constructor(options?: BulkheadOptions) {
    super({ ...BulkheadStrategy.DEFAULT_OPTIONS, ...options });
  }

  public process<T>(observable: Observable<T>, command?: BaseCommand): Observable<T> {
    if (this.executionSlots > 0) {
      return this.concurrent(observable);
    }

    if (this.queueSlots > 0) {
      return this.enqueue(observable);
    }

    const maxConcurrent = this.options.maxConcurrent ?? BulkheadStrategy.DEFAULT_OPTIONS.maxConcurrent ?? 1;
    const maxQueue = this.options.maxQueue ?? BulkheadStrategy.DEFAULT_OPTIONS.maxQueue ?? 1;

    ResilienceEventBus.getInstance().emit(ResilienceEventType.BulkheadRejected, command, this.active, maxConcurrent);

    return throwError(() => new BulkheadRejectedException(maxConcurrent, maxQueue));
  }

  private concurrent<T>(observable: Observable<T>): Observable<T> {
    this.active++;

    return observable.pipe(
      finalize(() => {
        this.active--;
        this.dequeue();
      }),
    );
  }

  private enqueue<T>(observable: Observable<T>): Observable<T> {
    this.queue.push(observable);

    return new Observable((subscriber) => {
      let executionSub: { unsubscribe: () => void } | undefined;

      const queueSub = this.queue$.subscribe((queuedObservable) => {
        if (queuedObservable === observable) {
          queueSub.unsubscribe();
          executionSub = this.concurrent(observable).subscribe(subscriber);
        }
      });

      return () => {
        queueSub.unsubscribe();
        if (executionSub) {
          executionSub.unsubscribe();
        } else {
          const idx = this.queue.indexOf(observable);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
        }
      };
    });
  }

  private dequeue(): void {
    if (this.executionSlots === 0) {
      return;
    }

    const observable = this.queue.shift();

    if (!observable) {
      return;
    }

    this.queue$.next(observable);
  }
}

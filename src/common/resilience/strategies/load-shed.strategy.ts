import { Observable, throwError } from 'rxjs';
import { BaseCommand } from '../commands/index.js';
import { ResilienceEventType, TrafficPriority } from '../enum/index.js';
import { LoadShedException } from '../exceptions/index.js';
import type { LoadShedOptions } from '../interfaces/index.js';
import { ResilienceEventBus } from '../resilience.event-bus.js';
import { SystemLoadSampler } from '../samplers/index.js';
import { Strategy } from './base.strategy.js';

export class LoadShedStrategy extends Strategy<LoadShedOptions> {
  public static readonly PRIORITY = 200;
  public override readonly executionPriority = LoadShedStrategy.PRIORITY;

  private static readonly DEFAULT_OPTIONS: LoadShedOptions = {
    priority: TrafficPriority.DEFAULT,
  };

  public constructor(options?: LoadShedOptions) {
    super({ ...LoadShedStrategy.DEFAULT_OPTIONS, ...options });
  }

  public process<T>(observable: Observable<T>, command?: BaseCommand): Observable<T> {
    const priority = this.options.priority ?? TrafficPriority.DEFAULT;
    const sampler = this.options.sampler ?? SystemLoadSampler.getShared();

    const shedResult = sampler.shouldShed(priority);
    if (shedResult.shouldShed) {
      const reason = shedResult.reason ?? 'System overload';
      const logPayload = {
        msg: `Execution shed due to system overload [Priority: ${priority}]`,
        priority,
        reason,
      };

      if (priority === TrafficPriority.SHEDDABLE) {
        this.logger.log(logPayload);
      } else if (priority === TrafficPriority.DEFAULT) {
        this.logger.warn(logPayload);
      } else {
        this.logger.error(logPayload);
      }

      ResilienceEventBus.getInstance().emit(ResilienceEventType.LoadShedDrop, command, priority, reason);

      return throwError(() => new LoadShedException(priority, reason));
    }

    return observable;
  }
}

import { Observable, throwError } from 'rxjs';

import { HealthCheckFailedException } from '../exceptions/index.js';
import { HealthCheckOptions } from '../interfaces/index.js';
import { Strategy } from './base.strategy.js';

export class HealthCheckStrategy extends Strategy<HealthCheckOptions> {
  public static readonly PRIORITY = 850;
  public override readonly executionPriority = HealthCheckStrategy.PRIORITY;

  public constructor(options: HealthCheckOptions) {
    super(options);
  }

  public process<T>(observable: Observable<T>): Observable<T> {
    return this.options() ? observable : throwError(() => new HealthCheckFailedException());
  }
}

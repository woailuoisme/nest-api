import { catchError, Observable, of } from 'rxjs';

import { BaseCommand } from '../commands/index.js';
import { FallbackOptions } from '../interfaces/index.js';
import { Strategy } from './base.strategy.js';

export class FallbackStrategy extends Strategy<FallbackOptions> {
  public static readonly PRIORITY = 800;
  public override readonly executionPriority = FallbackStrategy.PRIORITY;

  public constructor(options: FallbackOptions) {
    super(options);
  }

  public process<T>(observable: Observable<T>, command?: BaseCommand, ...args: unknown[]): Observable<T> {
    return observable.pipe(catchError(() => of(this.options(command, ...args) as T)));
  }
}

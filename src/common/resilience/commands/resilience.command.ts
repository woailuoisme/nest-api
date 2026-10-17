import { catchError, defer, lastValueFrom, Observable, tap } from 'rxjs';

import { ResilienceEventType } from '../enum/index.js';
import { BaseCommand, ParametersOfRun, ReturnTypeOfRun } from './base.command.js';

export abstract class ResilienceCommand extends BaseCommand {
  public abstract run(...args: unknown[]): Promise<unknown>;

  public execute(...args: ParametersOfRun<this>): ReturnTypeOfRun<this> {
    this.eventBus.emit(ResilienceEventType.Emit, this);

    let observable = defer(() => this.run(...args)) as Observable<ReturnTypeOfRun<this>>;

    for (const strategy of this.strategies) {
      observable = strategy.process(observable, this, ...args);
    }

    return lastValueFrom(
      observable.pipe(
        catchError((error) => {
          throw this.onFailure(error);
        }),
        tap(() => this.onSuccess()),
      ),
    ) as ReturnTypeOfRun<this>;
  }
}

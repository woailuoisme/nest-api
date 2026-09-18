import { catchError, Observable, tap } from 'rxjs';
import { ResilienceEventType } from '../enum/index.js';
import { BaseCommand, ParametersOfRun, ReturnTypeOfRun } from './base.command.js';

export abstract class ResilienceObservableCommand extends BaseCommand {
  public abstract run(...args: unknown[]): Observable<unknown>;

  public execute(...args: ParametersOfRun<this>): ReturnTypeOfRun<this> {
    this.eventBus.emit(ResilienceEventType.Emit, this);

    let observable = this.run(...args);

    for (const strategy of this.strategies) {
      observable = strategy.process(observable, this, ...args);
    }

    return observable.pipe(
      catchError((error) => {
        throw this.onFailure(error);
      }),
      tap(() => this.onSuccess()),
    ) as ReturnTypeOfRun<this>;
  }
}

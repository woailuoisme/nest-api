import { from, Observable, of, switchMap, tap } from 'rxjs';
import { BaseCommand } from '../commands/index.js';
import { CacheOptions } from '../interfaces/index.js';
import { ResilienceStatesManager } from '../resilience.states-manager.js';
import { Strategy } from './base.strategy.js';

export class CacheStrategy extends Strategy<CacheOptions> {
  public static readonly PRIORITY = 100;
  public override readonly executionPriority = CacheStrategy.PRIORITY;

  private static readonly DEFAULT_TTL = 30 * 1000;

  constructor(options: CacheOptions = CacheStrategy.DEFAULT_TTL) {
    super(options);
  }

  public process<T = unknown>(observable: Observable<T>, command?: BaseCommand, ...args: unknown[]): Observable<T> {
    const statesManager = ResilienceStatesManager.getInstance();
    const key = [this.name, command, JSON.stringify(args)].join('/');

    return from(statesManager.get<T>(key)).pipe(
      switchMap((cache) =>
        cache ? of(cache) : observable.pipe(tap((value) => statesManager.set(key, value, this.options))),
      ),
    );
  }
}

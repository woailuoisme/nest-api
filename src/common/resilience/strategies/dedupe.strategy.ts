import { Observable, Subject, tap } from 'rxjs';
import { BaseCommand } from '../commands/index.js';
import { DedupeOptions } from '../interfaces/index.js';
import { Strategy } from './base.strategy.js';

export class DedupeStrategy extends Strategy<DedupeOptions> {
  public static readonly PRIORITY = 150;
  public override readonly executionPriority = DedupeStrategy.PRIORITY;

  private static readonly DEFAULT_OPTIONS: DedupeOptions = {
    keyFn: (args: unknown[], command: BaseCommand) => [DedupeStrategy.name, command, JSON.stringify(args)].join('/'),
  };

  private readonly activeCommands = new Map<string, Subject<unknown>>();

  public constructor(options?: DedupeOptions) {
    super({ ...DedupeStrategy.DEFAULT_OPTIONS, ...options });
  }

  public process<T>(observable: Observable<T>, command: BaseCommand, ...args: unknown[]): Observable<T> {
    const keyFn =
      this.options.keyFn ??
      DedupeStrategy.DEFAULT_OPTIONS.keyFn ??
      ((a, c) => [DedupeStrategy.name, c, JSON.stringify(a)].join('/'));
    const key = keyFn(args, command);

    const existing = this.activeCommands.get(key);
    if (existing) {
      return existing.asObservable() as Observable<T>;
    }

    const result = observable;
    const subject = new Subject();
    this.activeCommands.set(key, subject);

    return result.pipe(
      tap({
        next: (res) => {
          subject.next(res);
          subject.complete();
          this.activeCommands.delete(key);
        },
        error: (err) => {
          subject.error(err);
          subject.complete();
          this.activeCommands.delete(key);
        },
      }),
    );
  }
}

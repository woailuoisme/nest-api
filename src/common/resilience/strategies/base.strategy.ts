import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';

import { BaseCommand } from '../commands/index.js';

export abstract class Strategy<Options = unknown> {
  protected readonly name = this.constructor.name;

  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Execution priority in the resilience pipeline.
   * Lower numbers are wrapped first (inner layer, closer to the target).
   * Higher numbers are wrapped last (outer layer, closer to caller, e.g. Fallback, Retry).
   */
  public readonly executionPriority: number = 500;

  protected constructor(protected options: Options) {}

  public setOptions(options: Options): void {
    this.options = options;
  }

  public updateOption<K extends keyof Options>(key: K, value: Options[K]): void {
    this.options[key] = value;
  }

  public updateOptions(options: Options): void {
    this.options = Object.assign(Object(this.options), options);
  }

  public getOptions(): Options {
    return this.options;
  }

  public clone(): this {
    return new (this.constructor as new (options: Options) => this)(this.options);
  }

  public abstract process<T>(observable: Observable<T>, command?: BaseCommand, ...args: unknown[]): Observable<T>;
}

export { Strategy as BaseStrategy };

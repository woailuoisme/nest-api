import { Logger } from '@nestjs/common';

import { ResilienceEventType } from '../enum/index.js';
import { CircuitOpenedException, TimeoutException } from '../exceptions/index.js';
import { ResilienceEventBus } from '../resilience.event-bus.js';
import { Strategy } from '../strategies/index.js';

export type ParametersOfRun<T extends BaseCommand> = Parameters<T['run']>;
export type ReturnTypeOfRun<T extends BaseCommand> = ReturnType<T['run']>;

export interface BaseCommandOptions {
  disableAutoSort?: boolean;
}

export abstract class BaseCommand {
  protected readonly logger: Logger;

  protected readonly eventBus = ResilienceEventBus.getInstance();

  protected readonly strategies: Strategy[];

  public readonly group: string;

  public readonly name: string;

  public static sortStrategiesForExecution(strategies: Strategy[]): Strategy[] {
    return [...strategies].sort((a, b) => a.executionPriority - b.executionPriority);
  }

  public constructor(strategies: Strategy[], group?: string, name?: string, options?: BaseCommandOptions) {
    this.strategies = options?.disableAutoSort ? strategies : BaseCommand.sortStrategiesForExecution(strategies);
    this.group = group ?? 'default';
    this.name = name ?? this.constructor.name;
    this.logger = new Logger(this.toString());
  }

  /**
   * Abstract method to be implemented by the command
   * @param args
   */
  public abstract run(...args: unknown[]): unknown;

  public get executionStrategies(): readonly Strategy[] {
    return this.strategies;
  }

  public execute(..._args: ParametersOfRun<this>): ReturnTypeOfRun<this> {
    throw new Error('Method execute() must be implemented by subclass.');
  }

  protected onSuccess() {
    this.logger.debug('Command executed successfully');
    this.eventBus.emit(ResilienceEventType.Success, this);
  }

  protected onFailure(error: unknown) {
    if (error instanceof TimeoutException) {
      this.logger.debug('Command timed out');
      this.eventBus.emit(ResilienceEventType.Timeout, this);
    }

    if (error instanceof CircuitOpenedException) {
      this.logger.debug('Command short-circuited');
      this.eventBus.emit(ResilienceEventType.ShortCircuit, this);
    }

    this.logger.debug('Command failed');
    this.eventBus.emit(ResilienceEventType.Failure, this);
    return error;
  }

  public toString() {
    return `${this.group}#${this.name}`;
  }
}

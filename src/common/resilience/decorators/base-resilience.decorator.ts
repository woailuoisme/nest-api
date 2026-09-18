import type { BaseCommand, BaseCommandOptions } from '../commands/index.js';
import type { Strategy } from '../strategies/index.js';

export type TypedHandlerDescriptor<_T = unknown> = <F>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<F>,
) => TypedPropertyDescriptor<F>;

export type TypedHandlerDecorator = TypedHandlerDescriptor;

type CommandConstructor = new (
  strategies: Strategy[],
  group?: string,
  name?: string,
  options?: BaseCommandOptions,
) => BaseCommand;

export interface ResilienceDecoratorOptions {
  name?: string;
  group?: string;
  disableAutoSort?: boolean;
}

interface CommandMetadata {
  baseClass: CommandConstructor;
  strategies: Strategy[];
  className: string;
  propertyKey: string | symbol;
  options?: ResilienceDecoratorOptions;
}

const cache = new WeakMap<object, Record<string | symbol, BaseCommand>>();

export function getResilienceCommand(instance: object, propertyKey: string | symbol): BaseCommand | undefined {
  return cache.get(instance)?.[propertyKey];
}

export function BaseResilienceDecorator<_T = unknown>(
  baseClass: unknown,
  strategies: Strategy[],
  options?: ResilienceDecoratorOptions,
): TypedHandlerDescriptor<_T> {
  return <F>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<F>,
  ): TypedPropertyDescriptor<F> => {
    const originalMethod = descriptor.value as unknown as (...args: unknown[]) => unknown;

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const instance = (this && typeof this === 'object' ? this : target) as object;
      const command = getOrCreateCommand(instance, originalMethod, {
        baseClass: baseClass as CommandConstructor,
        strategies,
        className: options?.group ?? target.constructor.name,
        propertyKey,
        options,
      });

      return command.execute(...args);
    } as unknown as F;

    return descriptor;
  };
}

function getOrCreateCommand(
  instance: object,
  method: (...args: unknown[]) => unknown,
  metadata: CommandMetadata,
): BaseCommand {
  const resiliencyCommands = cache.get(instance) ?? {};

  if (!resiliencyCommands[metadata.propertyKey]) {
    class Command extends metadata.baseClass {
      public constructor() {
        super(
          metadata.strategies,
          metadata.options?.group ?? metadata.className,
          metadata.options?.name ?? String(metadata.propertyKey),
          metadata.options,
        );
      }

      public override run(...args: unknown[]) {
        return method.apply(instance, args);
      }
    }

    resiliencyCommands[metadata.propertyKey] = new Command();
    cache.set(instance, resiliencyCommands);
  }

  return resiliencyCommands[metadata.propertyKey];
}

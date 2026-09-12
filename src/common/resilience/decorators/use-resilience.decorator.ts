import { ResilienceCommand } from '../commands/index.js';
import { Strategy } from '../strategies/index.js';
import {
  BaseResilienceDecorator,
  type ResilienceDecoratorOptions,
  type TypedHandlerDescriptor,
} from './base-resilience.decorator.js';

function isOptions(arg: unknown): arg is ResilienceDecoratorOptions {
  return typeof arg === 'object' && arg !== null && !(arg instanceof Strategy) && !('executionPriority' in arg);
}

export function UseResilience(
  options: ResilienceDecoratorOptions,
  ...strategies: Strategy[]
): TypedHandlerDescriptor<Promise<unknown>>;
export function UseResilience(...strategies: Strategy[]): TypedHandlerDescriptor<Promise<unknown>>;
export function UseResilience(
  firstOrStrategy?: ResilienceDecoratorOptions | Strategy,
  ...remainingStrategies: Strategy[]
): TypedHandlerDescriptor<Promise<unknown>> {
  if (isOptions(firstOrStrategy)) {
    return BaseResilienceDecorator(ResilienceCommand, remainingStrategies, firstOrStrategy);
  }
  const strategies = (firstOrStrategy ? [firstOrStrategy, ...remainingStrategies] : remainingStrategies) as Strategy[];
  return BaseResilienceDecorator(ResilienceCommand, strategies);
}

import type { Observable } from 'rxjs';
import { ResilienceObservableCommand } from '../commands/index.js';
import { Strategy } from '../strategies/index.js';
import {
  BaseResilienceDecorator,
  type ResilienceDecoratorOptions,
  type TypedHandlerDescriptor,
} from './base-resilience.decorator.js';

function isOptions(arg: unknown): arg is ResilienceDecoratorOptions {
  return typeof arg === 'object' && arg !== null && !(arg instanceof Strategy) && !('executionPriority' in arg);
}

export function UseResilienceObservable(
  options: ResilienceDecoratorOptions,
  ...strategies: Strategy[]
): TypedHandlerDescriptor<Observable<unknown>>;
export function UseResilienceObservable(...strategies: Strategy[]): TypedHandlerDescriptor<Observable<unknown>>;
export function UseResilienceObservable(
  firstOrStrategy?: ResilienceDecoratorOptions | Strategy,
  ...remainingStrategies: Strategy[]
): TypedHandlerDescriptor<Observable<unknown>> {
  if (isOptions(firstOrStrategy)) {
    return BaseResilienceDecorator(ResilienceObservableCommand, remainingStrategies, firstOrStrategy);
  }
  const strategies = (firstOrStrategy ? [firstOrStrategy, ...remainingStrategies] : remainingStrategies) as Strategy[];
  return BaseResilienceDecorator(ResilienceObservableCommand, strategies);
}

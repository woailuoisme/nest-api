import { Injectable, type Type } from '@nestjs/common';

import type {
  BulkheadOptions,
  CacheOptions,
  CircuitBreakerOptions,
  DedupeOptions,
  FallbackOptions,
  HealthCheckOptions,
  LoadShedOptions,
  RetryOptions,
  ThrottleOptions,
  TimeoutOptions,
} from './interfaces/index.js';
import {
  BulkheadStrategy,
  CacheStrategy,
  CircuitBreakerStrategy,
  DedupeStrategy,
  FallbackStrategy,
  HealthCheckStrategy,
  LoadShedStrategy,
  RetryStrategy,
  Strategy,
  ThrottleStrategy,
  TimeoutStrategy,
} from './strategies/index.js';

@Injectable()
export class ResilienceFactory {
  public static createBulkheadStrategy(options?: BulkheadOptions) {
    return ResilienceFactory.createStrategy(BulkheadStrategy, options);
  }

  public static createCacheStrategy(options: CacheOptions) {
    return ResilienceFactory.createStrategy(CacheStrategy, options);
  }

  public static createCircuitBreakerStrategy(options?: CircuitBreakerOptions) {
    return ResilienceFactory.createStrategy(CircuitBreakerStrategy, options);
  }

  public static createFallbackStrategy(options: FallbackOptions) {
    return ResilienceFactory.createStrategy(FallbackStrategy, options);
  }

  public static createHealthCheckStrategy(options: HealthCheckOptions) {
    return ResilienceFactory.createStrategy(HealthCheckStrategy, options);
  }

  public static createRetryStrategy(options: RetryOptions) {
    return ResilienceFactory.createStrategy(RetryStrategy, options);
  }

  public static createThrottleStrategy(options: ThrottleOptions) {
    return ResilienceFactory.createStrategy(ThrottleStrategy, options);
  }

  public static createTimeoutStrategy(options: TimeoutOptions) {
    return ResilienceFactory.createStrategy(TimeoutStrategy, options);
  }

  public static createDedupeStrategy(options?: DedupeOptions) {
    return ResilienceFactory.createStrategy(DedupeStrategy, options);
  }

  public static createLoadShedStrategy(options?: LoadShedOptions) {
    return ResilienceFactory.createStrategy(LoadShedStrategy, options);
  }

  public static createStrategy<T>(strategy: Type<Strategy<T>>, options?: T) {
    return new strategy(options);
  }

  public static createCommand<T>(command: Type<T>, strategies: Strategy[]) {
    return new command(strategies);
  }

  public createBulkheadStrategy = ResilienceFactory.createBulkheadStrategy;
  public createCacheStrategy = ResilienceFactory.createCacheStrategy;
  public createCircuitBreakerStrategy = ResilienceFactory.createCircuitBreakerStrategy;
  public createFallbackStrategy = ResilienceFactory.createFallbackStrategy;
  public createHealthCheckStrategy = ResilienceFactory.createHealthCheckStrategy;
  public createRetryStrategy = ResilienceFactory.createRetryStrategy;
  public createThrottleStrategy = ResilienceFactory.createThrottleStrategy;
  public createTimeoutStrategy = ResilienceFactory.createTimeoutStrategy;
  public createDedupeStrategy = ResilienceFactory.createDedupeStrategy;
  public createLoadShedStrategy = ResilienceFactory.createLoadShedStrategy;
  public createStrategy = ResilienceFactory.createStrategy;
  public createCommand = ResilienceFactory.createCommand;
}

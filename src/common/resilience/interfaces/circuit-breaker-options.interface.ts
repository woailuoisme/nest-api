import { CacheOptions } from './cache-options.interface.js';
import { FallbackOptions } from './fallback-options.interface.js';
import { TimeoutOptions } from './timeout-options.interface.js';

export interface CircuitBreakerOptions {
  name?: string;

  /**
   * Capacity of the sliding window buffer (number of calls).
   * Default: 100.
   */
  slidingWindowSize?: number;

  /**
   * Minimum number of calls required before the failure rate can be calculated.
   * Default: 10.
   */
  minimumNumberOfCalls?: number;

  /**
   * Failure rate threshold percentage (0-100) that triggers state transition to OPEN.
   * Default: 50.
   */
  failureRateThreshold?: number;

  /**
   * Slow call rate threshold percentage (0-100) that triggers OPEN.
   */
  slowCallRateThreshold?: number;

  /**
   * Duration in ms above which a call is classified as slow.
   */
  slowCallDurationThresholdMs?: number;

  /**
   * Maximum permitted trial requests while in HALF_OPEN state.
   * Default: 5.
   */
  permittedNumberOfCallsInHalfOpenState?: number;

  /**
   * Number of consecutive successful trial requests required to recover from HALF_OPEN to CLOSED.
   * Default: 3.
   */
  successThresholdInHalfOpenState?: number;

  // Legacy & Compatibility Aliases
  requestVolumeThreshold?: number;
  sleepWindowInMilliseconds?: number;
  rollingWindowInMilliseconds?: number;
  errorThresholdPercentage?: number;
  timeoutInMilliseconds?: TimeoutOptions;
  cachedTimeoutInMilliseconds?: CacheOptions;
  fallback?: FallbackOptions | string;
  halfOpenAfterMs?: number;
  consecutiveFailures?: number;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  sampling?: {
    durationMs: number;
    failureRatio: number;
    minimumRps?: number;
  };
}

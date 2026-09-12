import { Type } from '@nestjs/common';

import { Backoff } from '../helpers/index.js';

export interface RetryOptions {
  maxRetries?: number;
  maxDelay?: number;
  backoff?: Backoff | Type<Backoff> | 'exponential' | 'constant';
  scaleFactor?: number;
  retryable?: (error: Error) => boolean;
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

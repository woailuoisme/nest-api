import { Backoff } from './base.backoff.js';

export class FibonacciBackoff extends Backoff {
  public *getGenerator(maxRetries: number): Generator<number, void, number> {
    let attempt = 0;
    let current = 1;
    let previous = 0;

    while (attempt < maxRetries) {
      const next = previous + current;
      previous = current;
      current = next;

      yield next * this.baseDelay;
      attempt += 1;
    }
  }
}

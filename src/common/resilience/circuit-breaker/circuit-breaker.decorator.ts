import type { CircuitBreakerOptions, ResilientOptions } from './circuit-breaker.types';
import { Resilient } from './resilient.decorator';

/**
 * 声明式断路器方法装饰器 (基于 cockatiel)
 *
 * 为目标 Service 的异步方法提供断路保护（Closed/Open/Half-Open）。
 * 当目标方法抛出错误达到阈值时跳闸，在冷却期内后续调用将被直接快速失败（抛出 BrokenCircuitError）或转由 fallback 执行。
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class PaymentService {
 *   @CircuitBreaker({ name: 'stripe', consecutiveFailures: 3, halfOpenAfterMs: 5000, fallback: 'chargeFallback' })
 *   async charge(amount: number) {
 *     return this.stripeClient.charge(amount);
 *   }
 *
 *   async chargeFallback(amount: number, error: unknown) {
 *     return { status: 'DEFERRED_OFFLINE', amount };
 *   }
 * }
 * ```
 */
export function CircuitBreaker(options: CircuitBreakerOptions = {}): MethodDecorator {
  const resilientOptions: ResilientOptions = {
    name: options.name,
    circuitBreaker: options,
    fallback: options.fallback,
    retry: false, // 纯断路器默认不附加重试，由 @Resilient 提供完整组合
  };

  return Resilient(resilientOptions);
}

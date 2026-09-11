import { Logger } from '@nestjs/common';
import { ResilienceRegistryService } from '../circuit-breaker/resilience-registry.service';
import { isRateLimitExceededError, type RateLimitOptions } from './rate-limiter.types';

const logger = new Logger('OutboundRateLimitDecorator');

export interface OutboundRateLimitDecoratorOptions<T = unknown> extends RateLimitOptions {
  /** 策略命名空间标识（默认：类名.方法名） */
  name?: string;
  /** 发生限流超额时的优雅降级回调函数或类方法名 */
  // biome-ignore lint/suspicious/noExplicitAny: 允许用户在 fallback 中使用自定义具体参数类型
  fallback?: string | ((error: unknown, ...args: any[]) => T | Promise<T>);
}

/**
 * 独立出站客户端配额限流方法装饰器
 *
 * 用于调用高频三方 API（如 OpenAI、微信支付、短信服务）防止触发 429 报错或封号。
 * 支持单机内存令牌桶与 Redis 全局分布式滑动窗口双驱动，并支持流量整形平滑排队。
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class WeChatPayService {
 *   @OutboundRateLimit({ limit: 100, windowMs: 1000, maxWaitMs: 2000 })
 *   async queryOrder(orderId: string) {
 *     return this.httpClient.get(`/pay/${orderId}`);
 *   }
 * }
 * ```
 */
export function OutboundRateLimit(options: OutboundRateLimitDecoratorOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const name = options.name ?? `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (...args: unknown[]) {
      const registry = ResilienceRegistryService.getShared();
      const policy = registry.getOrCreateRateLimiter(name, options);

      try {
        return await policy.execute(() => originalMethod.apply(this, args));
      } catch (error) {
        if (options.fallback && isRateLimitExceededError(error)) {
          logger.warn({
            msg: `Invoking fallback for @OutboundRateLimit method [${name}]`,
            error: (error as Error)?.message ?? error,
          });

          if (typeof options.fallback === 'function') {
            return options.fallback.apply(this, [error, ...args]);
          }
          if (typeof options.fallback === 'string') {
            const fallbackFn = (this as Record<string, unknown>)[options.fallback];
            if (typeof fallbackFn === 'function') {
              return fallbackFn.apply(this, [...args, error]);
            }
          }
        }
        throw error;
      }
    };

    return descriptor;
  };
}

import { Logger } from '@nestjs/common';
import { RequestContext } from '@/common/context';
import { DeadlineExceededError } from '../errors/deadline-exceeded.error';
import { TrafficPriority } from '../load-shedding/load-shedding.constants';
import { SystemLoadSampler, SystemOverloadedError } from '../load-shedding/system-load-sampler';
import type { ResilientOptions } from './circuit-breaker.types';
import { ResilienceRegistryService } from './resilience-registry.service';

const logger = new Logger('ResilientDecorator');

/**
 * 复合弹性治理方法装饰器 (Polly 风格经典金字塔流水线)
 *
 * 为目标异步方法编排统一的出站弹性治理流水线：
 * [外] Fallback -> Retry (指数退避+抖动) -> CircuitBreaker -> RateLimiter (配额令牌桶) -> Bulkhead (并发限制) -> Timeout [内]
 *
 * 工业级增强特性：
 * 1. 隐式全链路协作取消：自动嗅探 RequestContext.getSignal()，无需业务代码层层传递 AbortSignal；
 * 2. 截止时间超时预算 (Deadline Budget)：提前预检剩余毫秒数，若 <= 50ms 立即短路快速失败；
 * 3. 动态超时收敛：当下游预设超时大于全链路剩余时间时，自动缩紧执行超时至剩余预算，杜绝无效调用。
 *
 * @example
 * ```typescript
 * @Resilient({
 *   circuitBreaker: { consecutiveFailures: 3, halfOpenAfterMs: 5000 },
 *   rateLimit: { limit: 10, windowMs: 1000, maxWaitMs: 500 },
 *   retry: { attempts: 2, backoff: 'exponential' },
 *   timeout: 3000,
 *   bulkhead: { maxConcurrent: 10 },
 *   shedIfOverloaded: TrafficPriority.SHEDDABLE,
 *   fallback: 'fallbackHandler'
 * })
 * async callExternalApi() { ... }
 * ```
 */
export function Resilient(options: ResilientOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const name = options.name ?? `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (...args: unknown[]) {
      const registry = ResilienceRegistryService.getShared();
      const pipeline = registry.getOrCreatePipeline(name, options);

      // 1. 优先从 options、入参，次之从 RequestContext ALS 隐式上下文提取 AbortSignal
      const contextSignal = RequestContext.getSignal();
      const explicitSignal = (options.signal ??
        args.find(
          (a) =>
            a instanceof AbortSignal ||
            (a && typeof a === 'object' && 'aborted' in a && typeof (a as { aborted: unknown }).aborted === 'boolean'),
        )) as AbortSignal | undefined;

      const parentSignal = explicitSignal ?? contextSignal;

      // 2. 检查截止时间超时预算 (Deadline Budget)
      const remainingMs = RequestContext.getRemainingMs();
      if (remainingMs !== undefined) {
        if (remainingMs <= 50) {
          const budgetError = new DeadlineExceededError(
            `Remaining timeout budget (${remainingMs}ms) is insufficient (min: 50ms)`,
            remainingMs,
            50,
          );
          if (options.fallback) {
            return invokeFallback(options.fallback, this, budgetError, args, name);
          }
          throw budgetError;
        }
      }

      // 3. 构建动态预算控制定时器与合成 Signal
      let effectiveSignal = parentSignal;
      let budgetTimer: ReturnType<typeof setTimeout> | undefined;
      let budgetController: AbortController | undefined;

      if (remainingMs !== undefined && Number.isFinite(remainingMs) && remainingMs > 50) {
        const configuredTimeout = typeof options.timeout === 'number' ? options.timeout : undefined;
        // 若剩余链路预算比设定的超时更紧，动态将超时收敛到剩余预算
        const targetTimeout = configuredTimeout ? Math.min(configuredTimeout, remainingMs) : remainingMs;

        budgetController = new AbortController();
        budgetTimer = setTimeout(() => {
          budgetController?.abort(
            new DeadlineExceededError(`Deadline budget exceeded after ${targetTimeout}ms`, 0, 50),
          );
        }, targetTimeout);
        budgetTimer.unref?.();

        if (parentSignal) {
          if (typeof AbortSignal.any === 'function') {
            effectiveSignal = AbortSignal.any([parentSignal, budgetController.signal]);
          } else {
            const merged = new AbortController();
            parentSignal.addEventListener('abort', () => merged.abort(parentSignal.reason), { once: true });
            budgetController.signal.addEventListener('abort', () => merged.abort(budgetController?.signal.reason), {
              once: true,
            });
            effectiveSignal = merged.signal;
          }
        } else {
          effectiveSignal = budgetController.signal;
        }
      }

      try {
        // 4. 若客户端/网关在发起前已取消，立即短路快速失败，杜绝浪费 CPU 与网络 I/O
        if (effectiveSignal?.aborted) {
          throw effectiveSignal.reason ?? new Error('Operation aborted');
        }

        // 5. 检查运行时过载脱落短路
        if (options.shedIfOverloaded) {
          const priority =
            typeof options.shedIfOverloaded === 'string' ? options.shedIfOverloaded : TrafficPriority.DEFAULT;
          const sampler = SystemLoadSampler.getShared();
          const shedResult = sampler.shouldShed(priority);
          if (shedResult.shouldShed) {
            throw new SystemOverloadedError(shedResult.reason, priority);
          }
        }

        // 6. 将 signal 深度穿透至 Cockatiel 弹性流水线 (Retry / RateLimit / Bulkhead / Timeout)
        return await pipeline.execute(() => originalMethod.apply(this, args), effectiveSignal);
      } catch (error) {
        // 区分是超时预算耗尽，还是客户端主动中断取消
        const isBudgetAbort = budgetController?.signal.aborted;
        if (isBudgetAbort && budgetController) {
          const budgetErr =
            budgetController.signal.reason instanceof DeadlineExceededError
              ? budgetController.signal.reason
              : new DeadlineExceededError('Deadline budget exceeded', 0, 50);

          if (options.fallback) {
            return invokeFallback(options.fallback, this, budgetErr, args, name);
          }
          throw budgetErr;
        }

        const isClientAborted = parentSignal?.aborted || (error as Error)?.name === 'AbortError';
        if (isClientAborted) {
          throw parentSignal?.reason ?? error;
        }

        if (options.fallback) {
          return invokeFallback(options.fallback, this, error, args, name);
        }
        throw error;
      } finally {
        if (budgetTimer) {
          clearTimeout(budgetTimer);
        }
      }
    };

    return descriptor;
  };
}

function invokeFallback(
  fallback: NonNullable<ResilientOptions['fallback']>,
  context: unknown,
  error: unknown,
  args: unknown[],
  name: string,
) {
  logger.warn({
    msg: `Invoking fallback for @Resilient method [${name}]`,
    error: (error as Error)?.message ?? error,
  });

  if (typeof fallback === 'function') {
    return fallback.apply(context, [error, ...args]);
  }
  if (typeof fallback === 'string') {
    const fallbackFn = (context as Record<string, unknown>)[fallback];
    if (typeof fallbackFn === 'function') {
      return fallbackFn.apply(context, [...args, error]);
    }
  }
  throw error;
}

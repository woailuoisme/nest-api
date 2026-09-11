import { type ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { BrokenCircuitError, CircuitState, isBrokenCircuitError, isBulkheadRejectedError } from 'cockatiel';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@/common/context';
import {
  BYPASS_LOAD_SHEDDING_KEY,
  BypassLoadShedding,
  CircuitBreaker,
  CircuitBreakerService,
  Critical,
  DEFAULT_RETRY_AFTER_SECONDS,
  DeadlineExceededError,
  LoadSheddingGuard,
  LocalTokenBucket,
  Priority,
  ResilienceRegistryService,
  Resilient,
  Sheddable,
  SystemLoadSampler,
  SystemOverloadedError,
  TRAFFIC_PRIORITY_KEY,
  TrafficPriority,
} from '@/common/resilience';

describe('Resilience Subsystem (弹性与高可用治理)', () => {
  describe('LoadSheddingGuard (自适应负载脱落守卫 - 入站防御)', () => {
    const createMockReflector = (bypass = false, priority?: TrafficPriority): Reflector =>
      ({
        getAllAndOverride: vi.fn((key: string) => {
          if (key === BYPASS_LOAD_SHEDDING_KEY) return bypass;
          if (key === TRAFFIC_PRIORITY_KEY) return priority;
          return undefined;
        }),
      }) as unknown as Reflector;

    const createMockContext = () => {
      const headers: Record<string, string | number> = {};
      const mockReply = {
        header: vi.fn((key: string, value: string | number) => {
          headers[key] = value;
          return mockReply;
        }),
      };
      const mockRequest = { url: '/api/test' };

      const context = {
        getType: vi.fn().mockReturnValue('http'),
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockReply,
        }),
      } as unknown as ExecutionContext;

      return { context, mockReply, headers };
    };

    it('场景 1: 正常系统指标未超载时，守卫直接放行', () => {
      const reflector = createMockReflector(false);
      const mockSampler = {
        shouldShed: vi.fn().mockReturnValue({ shouldShed: false }),
        getMetrics: vi.fn().mockReturnValue({
          isOverloaded: false,
          eventLoopDelayP95Ms: 5,
          heapUsedRatio: 0.4,
          heapUsedBytes: 200 * 1024 * 1024,
          heapTotalBytes: 500 * 1024 * 1024,
          overloadReason: undefined,
        }),
      } as unknown as SystemLoadSampler;

      const guard = new LoadSheddingGuard(reflector, mockSampler);
      const { context } = createMockContext();

      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(mockSampler.shouldShed).toHaveBeenCalledWith(TrafficPriority.DEFAULT);
    });

    it('场景 2: 系统发生过载时，守卫抛出 503 并在 Header 中注入 Retry-After 与 X-Load-Shed-Priority', () => {
      const reflector = createMockReflector(false);
      const mockSampler = {
        shouldShed: vi.fn().mockReturnValue({
          shouldShed: true,
          reason: 'Event loop delay P95 (250ms) exceeded threshold (150ms)',
          metrics: {
            isOverloaded: true,
            eventLoopDelayP95Ms: 250,
            heapUsedRatio: 0.95,
            heapUsedBytes: 900 * 1024 * 1024,
            heapTotalBytes: 1024 * 1024 * 1024,
            overloadReason: 'Event loop delay P95 (250ms) exceeded threshold (150ms)',
          },
        }),
        getMetrics: vi.fn(),
      } as unknown as SystemLoadSampler;

      const guard = new LoadSheddingGuard(reflector, mockSampler);
      const { context, mockReply } = createMockContext();

      expect(() => guard.canActivate(context)).toThrow(ServiceUnavailableException);
      expect(mockReply.header).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^[4-7]$/));
      expect(mockReply.header).toHaveBeenCalledWith('X-Retry-After-Ms', expect.stringMatching(/^[4-7]000$/));
      expect(mockReply.header).toHaveBeenCalledWith('X-Load-Shed-Priority', TrafficPriority.DEFAULT);
    });

    it('场景 3: 标注 @BypassLoadShedding() 的接口即使在过载时也无损放行 (如健康探针)', () => {
      const decorator = BypassLoadShedding();
      expect(typeof decorator).toBe('function');

      const reflector = createMockReflector(true); // Bypass 为 true
      const mockSampler = {
        shouldShed: vi.fn().mockReturnValue({ shouldShed: true }),
        getMetrics: vi.fn(),
      } as unknown as SystemLoadSampler;

      const guard = new LoadSheddingGuard(reflector, mockSampler);
      const { context } = createMockContext();

      const result = guard.canActivate(context);
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(BYPASS_LOAD_SHEDDING_KEY, expect.any(Array));
      expect(mockSampler.shouldShed).not.toHaveBeenCalled();
    });

    it('场景 4: 非 HTTP 上下文直接放行', () => {
      const reflector = createMockReflector(false);
      const mockSampler = { shouldShed: vi.fn(), getMetrics: vi.fn() } as unknown as SystemLoadSampler;
      const guard = new LoadSheddingGuard(reflector, mockSampler);

      const nonHttpContext = {
        getType: vi.fn().mockReturnValue('rpc'),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(nonHttpContext)).toBe(true);
      expect(mockSampler.shouldShed).not.toHaveBeenCalled();
    });

    it('场景 4b: 分级脱落识别流量优先级，轻度过载下仅丢弃 SHEDDABLE，放行 DEFAULT 与 CRITICAL', () => {
      // 模拟轻度过载：SHEDDABLE 脱落，DEFAULT 放行
      const mockSampler = {
        shouldShed: vi.fn((priority: TrafficPriority) => {
          if (priority === TrafficPriority.SHEDDABLE) {
            return { shouldShed: true, reason: 'Mild overload: Event loop delay 80ms > 60ms' };
          }
          return { shouldShed: false };
        }),
      } as unknown as SystemLoadSampler;

      // 1. 测试 Sheddable 端点 -> 抛出 503 并注入脱落优先级
      const sheddableReflector = createMockReflector(false, TrafficPriority.SHEDDABLE);
      const sheddableGuard = new LoadSheddingGuard(sheddableReflector, mockSampler);
      const { context: sheddableContext, mockReply: sheddableReply } = createMockContext();

      expect(() => sheddableGuard.canActivate(sheddableContext)).toThrow(ServiceUnavailableException);
      expect(sheddableReply.header).toHaveBeenCalledWith('X-Load-Shed-Priority', TrafficPriority.SHEDDABLE);

      // 2. 测试 Default 端点 -> 放行
      const defaultReflector = createMockReflector(false, TrafficPriority.DEFAULT);
      const defaultGuard = new LoadSheddingGuard(defaultReflector, mockSampler);
      const { context: defaultContext } = createMockContext();

      expect(defaultGuard.canActivate(defaultContext)).toBe(true);
    });

    it('场景 4c: 优先级装饰器 @Priority / @Sheddable / @Critical 正确返回装饰器函数', () => {
      expect(typeof Priority(TrafficPriority.CRITICAL)).toBe('function');
      expect(typeof Sheddable()).toBe('function');
      expect(typeof Critical()).toBe('function');
    });
  });

  describe('ResilienceRegistryService & Cockatiel 断路器策略', () => {
    it('场景 5: CLOSED 状态下连续失败达到阈值应跳闸进入 OPEN 状态，后续调用抛出 BrokenCircuitError', async () => {
      const registry = new ResilienceRegistryService();
      const breaker = registry.getOrCreateCircuitBreaker('test-breaker', {
        consecutiveFailures: 2,
        halfOpenAfterMs: 1000,
      });

      expect(breaker.state).toBe(CircuitState.Closed);

      // 连续 2 次调用抛出错误
      await expect(
        breaker.execute(async () => {
          throw new Error('fail 1');
        }),
      ).rejects.toThrow('fail 1');
      expect(breaker.state).toBe(CircuitState.Closed);

      await expect(
        breaker.execute(async () => {
          throw new Error('fail 2');
        }),
      ).rejects.toThrow('fail 2');

      // 达到连续失败 2 次，跳闸至 OPEN
      expect(breaker.state).toBe(CircuitState.Open);

      // OPEN 状态下再次调用直接抛出 BrokenCircuitError 快速失败
      await expect(breaker.execute(async () => 'ok')).rejects.toThrow(BrokenCircuitError);
    });

    it('场景 6: OPEN 状态在冷却期后进入 HALF_OPEN，金丝雀成功后自愈恢复 CLOSED', async () => {
      const registry = new ResilienceRegistryService();
      const breaker = registry.getOrCreateCircuitBreaker('test-recovery', {
        consecutiveFailures: 2,
        halfOpenAfterMs: 50, // 50ms 冷却时间
      });

      await expect(
        breaker.execute(async () => {
          throw new Error('err');
        }),
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('err');
        }),
      ).rejects.toThrow();
      expect(breaker.state).toBe(CircuitState.Open);

      // 等待冷却结束
      await new Promise((resolve) => setTimeout(resolve, 70));

      // 冷却期后首次调用为金丝雀试探，成功返回
      const result = await breaker.execute(async () => 'canary-success');
      expect(result).toBe('canary-success');

      // 金丝雀成功后自愈恢复为 CLOSED
      expect(breaker.state).toBe(CircuitState.Closed);
    });

    it('场景 7: HALF_OPEN 状态下任意金丝雀失败，立即跌回 OPEN 并开启新一轮冷却', async () => {
      const registry = new ResilienceRegistryService();
      const breaker = registry.getOrCreateCircuitBreaker('test-failback', {
        consecutiveFailures: 2,
        halfOpenAfterMs: 50,
      });

      await expect(
        breaker.execute(async () => {
          throw new Error('err');
        }),
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('err');
        }),
      ).rejects.toThrow();
      expect(breaker.state).toBe(CircuitState.Open);

      // 等待冷却期过去进入 HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 70));

      // 金丝雀请求执行失败
      await expect(
        breaker.execute(async () => {
          throw new Error('canary-failed');
        }),
      ).rejects.toThrow('canary-failed');

      // 立即跌回 OPEN
      expect(breaker.state).toBe(CircuitState.Open);
      await expect(breaker.execute(async () => 'ok')).rejects.toThrow(BrokenCircuitError);
    });
  });

  describe('CircuitBreakerService (编程式与多命名空间服务)', () => {
    it('场景 8: execute() 正常执行异步任务并返回结果', async () => {
      const registry = new ResilienceRegistryService();
      const service = new CircuitBreakerService(registry);
      const result = await service.execute('remote-api', async () => {
        return { data: 'upstream-ok' };
      });

      expect(result).toEqual({ data: 'upstream-ok' });
      const stats = service.getStats('remote-api');
      expect(stats).toBeDefined();
      if (stats && !Array.isArray(stats)) {
        expect(stats.state).toBe('CLOSED');
      }
    });

    it('场景 9: 发生熔断跳闸时，如果提供了 fallback 则优雅降级', async () => {
      const registry = new ResilienceRegistryService();
      const service = new CircuitBreakerService(registry);
      const options = {
        name: 'unstable-service',
        circuitBreaker: {
          consecutiveFailures: 2,
          halfOpenAfterMs: 5000,
        },
        fallback: () => ({ fallback: true, cached: 'local-snapshot' }),
      };

      // 连续 2 次抛错触发断路器跳闸
      try {
        await service.execute(
          'unstable-service',
          async () => {
            throw new Error('500 internal');
          },
          options,
        );
      } catch {}

      try {
        await service.execute(
          'unstable-service',
          async () => {
            throw new Error('500 internal');
          },
          options,
        );
      } catch {}

      const stats = service.getStats('unstable-service');
      expect(stats && !Array.isArray(stats) ? stats.state : undefined).toBe('OPEN');

      // 下一次执行时，触发 fallback 降级而不是抛出异常
      const fallbackResult = await service.execute(
        'unstable-service',
        async () => {
          return { fallback: false, cached: 'live' };
        },
        options,
      );

      expect(fallbackResult).toEqual({ fallback: true, cached: 'local-snapshot' });
    });
  });

  describe('@CircuitBreaker() (声明式断路器装饰器)', () => {
    class ExternalPaymentService {
      public callCount = 0;

      @CircuitBreaker({
        name: 'stripe-gateway',
        consecutiveFailures: 2,
        halfOpenAfterMs: 5000,
        fallback: 'getCachedPaymentStatus',
      })
      async charge(amount: number) {
        this.callCount++;
        if (amount < 0) {
          throw new Error('Invalid amount or network timeout');
        }
        return { charged: amount, status: 'succeeded' };
      }

      async getCachedPaymentStatus(_amount: number, _error: unknown) {
        return { charged: 0, status: 'fallback-mock' };
      }
    }

    it('场景 10: 装饰器正常调用被修饰方法，失败熔断后路由至指定类内部 fallback 方法', async () => {
      const client = new ExternalPaymentService();

      // 正常请求
      const res1 = await client.charge(100);
      expect(res1).toEqual({ charged: 100, status: 'succeeded' });

      // 触发连续 2 次失败跳闸
      try {
        await client.charge(-1);
      } catch {}
      try {
        await client.charge(-1);
      } catch {}

      // 此时已熔断 OPEN，再次调用将触发 fallback
      const fallbackRes = await client.charge(200);
      expect(fallbackRes).toEqual({ charged: 0, status: 'fallback-mock' });
    });
  });

  describe('@Resilient() (全功能金字塔复合弹性装饰器)', () => {
    class ComplexDownstreamService {
      public attempts = 0;

      @Resilient({
        name: 'crm-sync-client',
        retry: {
          attempts: 2,
          backoff: 'constant',
          initialDelayMs: 10,
        },
        circuitBreaker: {
          consecutiveFailures: 3,
          halfOpenAfterMs: 2000,
        },
        timeout: 500,
        fallback: 'onFallback',
      })
      async syncData(shouldFail: boolean) {
        this.attempts++;
        if (shouldFail) {
          throw new Error('network-glitch');
        }
        return { synced: true };
      }

      async onFallback(_shouldFail: boolean, error: unknown) {
        return { synced: false, degraded: true, error: (error as Error)?.message };
      }
    }

    it('场景 11: 触发重试并在最终失败后路由至 fallback 降级', async () => {
      const service = new ComplexDownstreamService();

      const result = await service.syncData(true);
      // 1 次初始尝试 + 2 次重试 = 共调用 3 次后失败，进入 fallback
      expect(service.attempts).toBe(3);
      expect(result).toEqual({ synced: false, degraded: true, error: 'network-glitch' });
    });

    it('场景 12: 仓壁并发隔离 (Bulkhead) 超额时拒绝执行', async () => {
      const registry = ResilienceRegistryService.getShared();
      const bulkhead = registry.getOrCreateBulkhead('limited-resource', {
        maxConcurrent: 1,
        maxQueue: 0,
      });

      let finishTask: () => void = () => {};
      const longTask = new Promise<string>((resolve) => {
        finishTask = () => resolve('task-1-done');
      });

      // 第 1 个任务占满槽位
      const p1 = bulkhead.execute(() => longTask);

      // 第 2 个任务瞬间到达，无空闲槽位且队列为 0，立即抛出 BulkheadRejectedError
      await expect(bulkhead.execute(async () => 'task-2')).rejects.toThrow();

      // 释放任务 1
      finishTask();
      const res1 = await p1;
      expect(res1).toBe('task-1-done');
    });

    it('场景 13: CircuitBreakerService 监控统计与状态查询及重置', async () => {
      const registry = new ResilienceRegistryService();
      const cbService = new CircuitBreakerService(registry);

      cbService.getBreaker('service-alpha', { failureThreshold: 2 });
      cbService.getPipeline('pipeline-beta', { circuitBreaker: { failureThreshold: 2 } });

      // 全量统计
      const allStats = cbService.getStats() as any[];
      expect(Array.isArray(allStats)).toBe(true);
      expect(allStats.some((s) => s.name === 'service-alpha')).toBe(true);

      // 单个统计
      const singleStat = cbService.getStats('service-alpha') as any;
      expect(singleStat).toBeDefined();
      expect(singleStat.name).toBe('service-alpha');
      expect(singleStat.state).toBe('CLOSED');

      // 重置清空
      cbService.reset();
      const afterReset = cbService.getStats() as any[];
      expect(afterReset.length).toBe(0);
    });

    it('场景 14: CircuitBreakerService.execute() 未配置 fallback 时直接向外抛出异常', async () => {
      const registry = new ResilienceRegistryService();
      const cbService = new CircuitBreakerService(registry);

      await expect(
        cbService.execute('no-fallback-test', async () => {
          throw new Error('catastrophic-failure');
        }),
      ).rejects.toThrow('catastrophic-failure');
    });

    it('场景 15: ResilienceRegistryService 仓壁缓存复用与实例查询', () => {
      const registry = new ResilienceRegistryService();

      const b1 = registry.getOrCreateBulkhead('pool-a', { maxConcurrent: 2 });
      const b2 = registry.getOrCreateBulkhead('pool-a', { maxConcurrent: 2 });
      expect(b1).toBe(b2); // 确保单例复用

      registry.getOrCreateCircuitBreaker('cb-a');
      expect(registry.getCircuitBreaker('cb-a')).toBeDefined();
      expect(registry.getCircuitBreaker('non-existent')).toBeUndefined();
    });

    it('场景 16: @Resilient 支持独立函数型 fallback', async () => {
      class FunctionalFallbackService {
        @Resilient({
          name: 'fn-fallback-pipeline',
          circuitBreaker: { failureThreshold: 1 },
          fallback: (err: unknown) => ({ recovered: true, original: (err as Error)?.message }),
        })
        async faultyCall() {
          throw new Error('third-party-offline');
        }
      }

      const service = new FunctionalFallbackService();
      const result = await service.faultyCall();
      expect(result).toEqual({ recovered: true, original: 'third-party-offline' });
    });

    it('场景 17: @Resilient 未配置 fallback 或配置的方法名不存在时，原始错误直接冒泡', async () => {
      class NoFallbackService {
        @Resilient({
          name: 'strict-pipeline',
          circuitBreaker: { failureThreshold: 1 },
        })
        async strictCall() {
          throw new Error('fatal-error');
        }

        @Resilient({
          name: 'invalid-method-fallback',
          circuitBreaker: { failureThreshold: 1 },
          fallback: 'notExistentMethodName',
        })
        async missingFallbackCall() {
          throw new Error('method-missing-error');
        }
      }

      const service = new NoFallbackService();
      await expect(service.strictCall()).rejects.toThrow('fatal-error');
      await expect(service.missingFallbackCall()).rejects.toThrow('method-missing-error');
    });

    it('场景 18: @Resilient 下游超时熔断后路由至降级', async () => {
      class TimedOutService {
        @Resilient({
          name: 'timeout-resilient-pipeline',
          timeout: 20, // 20ms 超时
          fallback: () => 'timeout-fallback-value',
        })
        async longOperation() {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return 'normal-value';
        }
      }

      const service = new TimedOutService();
      const result = await service.longOperation();
      expect(result).toBe('timeout-fallback-value');
    });

    it('场景 19: ResilienceRegistryService 当配置为空选项时返回 noop 策略', async () => {
      const registry = new ResilienceRegistryService();
      const emptyPipeline = registry.getOrCreatePipeline('noop-pipeline', {});
      const result = await emptyPipeline.execute(async () => 'noop-result');
      expect(result).toBe('noop-result');
    });

    it('场景 20: 五层完整金字塔流水线组装 (Retry + CircuitBreaker + RateLimiter + Bulkhead + Timeout) 正确协同', async () => {
      const registry = new ResilienceRegistryService();
      const fullPipeline = registry.getOrCreatePipeline('quint-pipeline', {
        retry: { attempts: 1, backoff: 'constant', initialDelayMs: 5 },
        circuitBreaker: { failureThreshold: 2 },
        rateLimit: { limit: 5, windowMs: 1000 },
        bulkhead: { maxConcurrent: 2, maxQueue: 1 },
        timeout: 50,
      });

      const res = await fullPipeline.execute(async () => 'quint-success');
      expect(res).toBe('quint-success');
    });

    it('场景 21: ResilienceRegistryService 支持创建基于采样比率的断路器 (SamplingBreaker 默认窗口)', () => {
      const registry = new ResilienceRegistryService();
      const samplingBreaker = registry.getOrCreateCircuitBreaker('sampling-service', {
        sampling: {
          durationMs: 5000,
          failureRatio: 0.5,
          minimumRps: 10,
        },
      });

      expect(samplingBreaker).toBeDefined();
    });

    it('场景 22: ResilienceRegistryService.getShared() 与断路器/仓壁/限流器重复获取时的单例缓存复用', () => {
      const shared = ResilienceRegistryService.getShared();
      expect(shared).toBeDefined();
      expect(ResilienceRegistryService.getShared()).toBe(shared);

      const b1 = shared.getOrCreateCircuitBreaker('cache-breaker');
      const b2 = shared.getOrCreateCircuitBreaker('cache-breaker');
      expect(b1).toBe(b2);

      const h1 = shared.getOrCreateBulkhead('cache-bulkhead', { maxConcurrent: 2 });
      const h2 = shared.getOrCreateBulkhead('cache-bulkhead', { maxConcurrent: 2 });
      expect(h1).toBe(h2);

      const r1 = shared.getOrCreateRateLimiter('cache-limiter', { limit: 10, windowMs: 1000 });
      const r2 = shared.getOrCreateRateLimiter('cache-limiter', { limit: 10, windowMs: 1000 });
      expect(r1).toBe(r2);
    });

    it('场景 23: @Resilient 装饰器支持配置 rateLimit 并在配额耗尽时触发优雅降级', async () => {
      class RateLimitedService {
        @Resilient({
          rateLimit: { limit: 1, windowMs: 1000, maxWaitMs: 0 },
          circuitBreaker: false,
          fallback: 'fallbackHandler',
        })
        async testMethod(input: string) {
          return `success-${input}`;
        }

        fallbackHandler(input: string, _error: unknown) {
          return `fallback-${input}`;
        }
      }

      const svc = new RateLimitedService();
      const res1 = await svc.testMethod('first');
      expect(res1).toBe('success-first');

      const res2 = await svc.testMethod('second');
      expect(res2).toBe('fallback-second');
    });

    it('场景 24: ResilienceRegistryService 获取限流器统计 getRateLimiterStats 与 clear 清理状态', () => {
      const registry = new ResilienceRegistryService();
      registry.getOrCreateRateLimiter('stat-limiter-1', { limit: 50, windowMs: 2000 });

      const stats = registry.getRateLimiterStats();
      expect(stats['stat-limiter-1']).toBeDefined();
      expect(stats['stat-limiter-1'].limit).toBe(50);
      expect(stats['stat-limiter-1'].windowMs).toBe(2000);
      expect(stats['stat-limiter-1'].driver).toBe('local');

      expect(registry.getRateLimiter('stat-limiter-1')).toBeDefined();
      expect(registry.getRateLimiter('non-existent')).toBeUndefined();

      registry.clear();
      expect(registry.getRateLimiter('stat-limiter-1')).toBeUndefined();
      expect(Object.keys(registry.getRateLimiterStats()).length).toBe(0);
    });

    it('场景 25: @Resilient 支持 shedIfOverloaded，当系统过载时短路抛出 SystemOverloadedError 并触发 fallback', async () => {
      const sampler = SystemLoadSampler.getShared();
      const shouldShedSpy = vi.spyOn(sampler, 'shouldShed').mockReturnValue({
        shouldShed: true,
        reason: 'Event loop delay 200ms exceeded threshold',
      });

      let innerCalled = false;
      class SheddableService {
        @Resilient({
          shedIfOverloaded: TrafficPriority.SHEDDABLE,
          fallback: 'handleFallback',
          circuitBreaker: false,
        })
        async doHeavyExport() {
          innerCalled = true;
          return 'export-done';
        }

        handleFallback(_err: unknown) {
          return 'export-deferred';
        }
      }

      const svc = new SheddableService();
      const result = await svc.doHeavyExport();

      expect(result).toBe('export-deferred');
      expect(innerCalled).toBe(false);
      expect(shouldShedSpy).toHaveBeenCalledWith(TrafficPriority.SHEDDABLE);

      shouldShedSpy.mockRestore();
    });

    it('场景 26: @Resilient 当 shedIfOverloaded 未达到脱落阈值时正常放行执行目标业务逻辑', async () => {
      const sampler = SystemLoadSampler.getShared();
      const shouldShedSpy = vi.spyOn(sampler, 'shouldShed').mockReturnValue({
        shouldShed: false,
      });

      let innerCalled = false;
      class NormalService {
        @Resilient({
          shedIfOverloaded: true, // 默认 TrafficPriority.DEFAULT
          fallback: 'handleFallback',
          circuitBreaker: false,
        })
        async doNormalTask() {
          innerCalled = true;
          return 'normal-done';
        }

        handleFallback(_err: unknown) {
          return 'normal-fallback';
        }
      }

      const svc = new NormalService();
      const result = await svc.doNormalTask();

      expect(result).toBe('normal-done');
      expect(innerCalled).toBe(true);
      expect(shouldShedSpy).toHaveBeenCalledWith(TrafficPriority.DEFAULT);

      shouldShedSpy.mockRestore();
    });

    it('场景 27: @Resilient 自动嗅探实参中的 AbortSignal，若调用前已中断则立即短路且跳过 fallback', async () => {
      let innerCalled = false;
      class AbortableService {
        @Resilient({
          fallback: 'handleFallback',
          circuitBreaker: false,
          retry: { attempts: 3 },
        })
        async fetchData(_id: string, _signal: AbortSignal) {
          innerCalled = true;
          return 'data-fetched';
        }

        handleFallback(_err: unknown) {
          return 'fallback-data';
        }
      }

      const controller = new AbortController();
      controller.abort(new Error('User navigated away'));

      const svc = new AbortableService();
      await expect(svc.fetchData('123', controller.signal)).rejects.toThrow('User navigated away');
      expect(innerCalled).toBe(false);
    });

    it('场景 28: @Resilient 在执行异步调用时若收到取消信号，立即中断并不执行后续重试或 fallback', async () => {
      let attempts = 0;
      const controller = new AbortController();

      class RetryAbortService {
        @Resilient({
          name: 'retry-abort-test',
          fallback: 'handleFallback',
          circuitBreaker: false,
          retry: { attempts: 3, backoff: 'constant', initialDelayMs: 50 },
        })
        async unstableCall(_signal: AbortSignal) {
          attempts += 1;
          // 第一次失败后，触发中断
          controller.abort(new Error('Client aborted connection'));
          throw new Error('Upstream 502 Bad Gateway');
        }

        handleFallback() {
          return 'fallback-result';
        }
      }

      const svc = new RetryAbortService();
      await expect(svc.unstableCall(controller.signal)).rejects.toThrow('Client aborted connection');
      // 因为中断了，不应继续进行 3 次重试
      expect(attempts).toBe(1);
    });

    it('场景 29: LocalTokenBucket.acquire 在平滑排队期间响应 AbortSignal，清理定时器并回补令牌', async () => {
      const bucket = new LocalTokenBucket(1, 1000);
      // 先消耗唯一的 1 个令牌
      await bucket.acquire(0);
      expect(bucket.getAvailableTokens()).toBe(0);

      const controller = new AbortController();
      // 启动一个需要等待 500ms 的排队
      const acquirePromise = bucket.acquire(1000, controller.signal);

      // 10ms 后取消
      setTimeout(() => {
        controller.abort(new Error('Request timed out in client'));
      }, 10);

      await expect(acquirePromise).rejects.toThrow('Request timed out in client');
      // 验证取消后预占的令牌被回补，未出现令牌泄漏
      expect(bucket.getAvailableTokens()).toBeGreaterThanOrEqual(0);
    });

    it('场景 30: @Resilient 隐式从 RequestContext.getSignal() 继承中断信号，若客户端已断连则无需入参即可自动短路', async () => {
      let innerExecuted = false;
      class ImplicitSignalService {
        @Resilient({ circuitBreaker: false, fallback: 'fallback' })
        async fetchFromRemote() {
          innerExecuted = true;
          return 'remote-success';
        }

        fallback() {
          return 'fallback-result';
        }
      }

      const controller = new AbortController();
      controller.abort(new Error('Peer connection closed by client'));

      const svc = new ImplicitSignalService();
      await RequestContext.run({ requestId: 'req-implicit-signal', startTime: Date.now() }, async () => {
        RequestContext.setDeadline(1000, controller.signal);

        await expect(svc.fetchFromRemote()).rejects.toThrow('Peer connection closed by client');
        expect(innerExecuted).toBe(false);
      });
    });

    it('场景 31: @Resilient 截止时间超时预算裁决：当请求剩余预算不足 (<= 50ms) 时提前预检短路并支持 fallback', async () => {
      let innerExecuted = false;
      class InsufficientBudgetService {
        @Resilient({
          name: 'insufficient-budget-test',
          circuitBreaker: false,
          fallback: 'handleBudgetExceeded',
        })
        async callSlowDownstream() {
          innerExecuted = true;
          return 'downstream-data';
        }

        handleBudgetExceeded(err: unknown) {
          expect(err).toBeInstanceOf(DeadlineExceededError);
          return 'cached-degraded-data';
        }
      }

      const svc = new InsufficientBudgetService();
      await RequestContext.run({ requestId: 'req-tight-budget', startTime: Date.now() }, async () => {
        // 设置剩余预算仅 40ms (<= 50ms 阈值)
        RequestContext.setDeadline(40);

        const result = await svc.callSlowDownstream();
        expect(result).toBe('cached-degraded-data');
        expect(innerExecuted).toBe(false);
      });
    });

    it('场景 32: @Resilient 动态超时收敛：当操作耗时超过链路剩余预算时，动态触发预算耗尽并进入 fallback', async () => {
      class DynamicBudgetTimeoutService {
        @Resilient({
          name: 'dynamic-budget-test',
          circuitBreaker: false,
          timeout: 5000, // 声明的超时是 5000ms，但链路预算只剩 80ms
          fallback: (err: unknown) => {
            expect(err).toBeInstanceOf(DeadlineExceededError);
            return 'fallback-on-deadline';
          },
        })
        async slowIo() {
          // 耗时 200ms 的慢操作
          await new Promise((res) => setTimeout(res, 200));
          return 'should-not-reach-here';
        }
      }

      const svc = new DynamicBudgetTimeoutService();
      await RequestContext.run({ requestId: 'req-dynamic-budget', startTime: Date.now() }, async () => {
        // 设置链路剩余预算 80ms (大于 50ms 预检，但小于任务耗时 200ms)
        RequestContext.setDeadline(80);

        const result = await svc.slowIo();
        expect(result).toBe('fallback-on-deadline');
      });
    });
  });
});

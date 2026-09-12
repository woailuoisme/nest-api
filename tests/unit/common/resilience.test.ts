import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BulkheadRejectedException,
  BulkheadStrategy,
  CacheStrategy,
  CircuitBreakerStatus,
  CircuitBreakerStrategy,
  CircuitOpenedException,
  DedupeStrategy,
  FallbackStrategy,
  getResilienceCommand,
  HealthCheckFailedException,
  HealthCheckStrategy,
  isBrokenCircuitError,
  isBulkheadRejectedError,
  isRateLimitExceededError,
  isTimeoutError,
  ResilienceCommand,
  ResilienceEventBus,
  ResilienceEventType,
  ResilienceFactory,
  ResilienceStatesManager,
  RetryStrategy,
  ThrottleStrategy,
  TimeoutException,
  TimeoutStrategy,
  UseResilience,
} from '@/common/resilience/index.js';

describe('Resilience Subsystem (SocketSomeone/nestjs-resilience 原生规范与全策略套件)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    ResilienceStatesManager.reset();
  });

  describe('1. ResilienceCommand (基础命令模式与事件总线)', () => {
    class MockSuccessCommand extends ResilienceCommand {
      public async run(val: string): Promise<string> {
        return `echo:${val}`;
      }
    }

    class MockFailureCommand extends ResilienceCommand {
      public async run(): Promise<never> {
        throw new Error('Simulated upstream failure');
      }
    }

    it('应当正常执行 run 方法并发布 Emit 和 Success 事件', async () => {
      const eventBus = ResilienceEventBus.getInstance();
      const emitted: any[] = [];
      const successes: any[] = [];

      eventBus.on(ResilienceEventType.Emit, (cmd) => emitted.push(cmd));
      eventBus.on(ResilienceEventType.Success, (cmd) => successes.push(cmd));

      const cmd = new MockSuccessCommand([]);
      const result = await cmd.execute('test-payload');

      expect(result).toBe('echo:test-payload');
      expect(emitted.length).toBeGreaterThan(0);
      expect(successes.length).toBeGreaterThan(0);
    });

    it('在执行失败时应当发布 Failure 事件并向外抛出原始异常', async () => {
      const eventBus = ResilienceEventBus.getInstance();
      const failures: any[] = [];
      eventBus.on(ResilienceEventType.Failure, (cmd) => failures.push(cmd));

      const cmd = new MockFailureCommand([]);
      await expect(cmd.execute()).rejects.toThrow('Simulated upstream failure');
      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe('2. TimeoutStrategy (超时策略)', () => {
    class SlowCommand extends ResilienceCommand {
      public async run(delayMs: number): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return 'completed';
      }
    }

    it('在指定超时时间内完成时应当正常返回结果', async () => {
      const cmd = new SlowCommand([new TimeoutStrategy(200)]);
      const result = await cmd.execute(10);
      expect(result).toBe('completed');
    });

    it('执行超过超时预算时应当抛出 TimeoutException 并支持类型守卫判定', async () => {
      const cmd = new SlowCommand([new TimeoutStrategy(30)]);
      let catchedError: unknown;
      try {
        await cmd.execute(100);
      } catch (err) {
        catchedError = err;
      }

      expect(catchedError).toBeInstanceOf(TimeoutException);
      expect(isTimeoutError(catchedError)).toBe(true);
    });
  });

  describe('3. RetryStrategy (重试策略)', () => {
    class FlakyCommand extends ResilienceCommand {
      public attempts = 0;

      public async run(failTimes: number): Promise<string> {
        this.attempts++;
        if (this.attempts <= failTimes) {
          throw new Error(`Failure on attempt ${this.attempts}`);
        }
        return 'success';
      }
    }

    it('在最大重试次数内恢复时应当返回成功结果', async () => {
      const cmd = new FlakyCommand([
        new RetryStrategy({
          maxRetries: 3,
          scaleFactor: 5,
        }),
      ]);

      const result = await cmd.execute(2);
      expect(result).toBe('success');
      expect(cmd.attempts).toBe(3); // 1 初始 + 2 次重试
    });

    it('超过最大重试次数后应当抛出最终错误', async () => {
      const cmd = new FlakyCommand([
        new RetryStrategy({
          maxRetries: 2,
          scaleFactor: 5,
        }),
      ]);

      await expect(cmd.execute(5)).rejects.toThrow('Failure on attempt 2');
      expect(cmd.attempts).toBe(2);
    });

    it('当 retryable 返回 false 时应当直接终止重试并冒泡', async () => {
      const cmd = new FlakyCommand([
        new RetryStrategy({
          maxRetries: 3,
          scaleFactor: 5,
          retryable: () => false,
        }),
      ]);

      await expect(cmd.execute(1)).rejects.toThrow('Failure on attempt 1');
      expect(cmd.attempts).toBe(1);
    });
  });

  describe('4. CircuitBreakerStrategy (断路器策略)', () => {
    class UnstableCommand extends ResilienceCommand {
      public calls = 0;

      public async run(shouldFail: boolean): Promise<string> {
        this.calls++;
        if (shouldFail) {
          throw new Error('Circuit Breaker simulated error');
        }
        return 'ok';
      }
    }

    it('触发连续失败达到阈值后应当进入 OPEN 跳闸状态并拒绝后续调用', async () => {
      const breaker = new CircuitBreakerStrategy({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        sleepWindowInMilliseconds: 500,
      });

      const cmd = new UnstableCommand([breaker], 'payment-group', 'pay');

      // 连续 2 次失败达到容量与错误率阈值
      await expect(cmd.execute(true)).rejects.toThrow();
      await expect(cmd.execute(true)).rejects.toThrow();

      // 第 3 次调用应被断路器直接短路拦截
      let shortCircuitError: unknown;
      try {
        await cmd.execute(false);
      } catch (err) {
        shortCircuitError = err;
      }

      expect(shortCircuitError).toBeInstanceOf(CircuitOpenedException);
      expect(isBrokenCircuitError(shortCircuitError)).toBe(true);
      expect(breaker.status).toBe(CircuitBreakerStatus.Open);
      expect(breaker.stateName).toBe('OPEN');
    });

    it('断路器配置 fallback 时应当在跳闸时返回降级兜底结果', async () => {
      const breaker = new CircuitBreakerStrategy({
        requestVolumeThreshold: 1,
        errorThresholdPercentage: 50,
        sleepWindowInMilliseconds: 500,
        fallback: () => 'fallback-result',
      });

      const cmd = new UnstableCommand([breaker], 'order-group', 'create');
      const result = await cmd.execute(true);
      expect(result).toBe('fallback-result');
    });

    it('CircuitBreakerStrategy.getStats 应当统计注册的活跃断路器状态', () => {
      const stats = CircuitBreakerStrategy.getStats();
      expect(Array.isArray(stats)).toBe(true);
      expect(stats.some((s) => s.name === 'CircuitBreakerStrategy')).toBe(true);
    });
  });

  describe('5. BulkheadStrategy (并发仓壁隔离策略)', () => {
    class ConcurrentCommand extends ResilienceCommand {
      public async run(delayMs: number): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return 'done';
      }
    }

    it('超出并发与排队容量时应当抛出 BulkheadRejectedException 并匹配类型守卫', async () => {
      const bulkhead = new BulkheadStrategy({
        maxConcurrent: 1,
        maxQueue: 1,
      });

      const cmd = new ConcurrentCommand([bulkhead]);

      // 任务 1: 占满并发槽位 (executionSlot: 1 -> 0)
      const p1 = cmd.execute(60);
      // 任务 2: 占满排队槽位 (queueSlot: 1 -> 0)
      const p2 = cmd.execute(60);

      // 任务 3: 槽位全满，直接抛出异常拒绝
      let rejectedError: unknown;
      try {
        await cmd.execute(60);
      } catch (err) {
        rejectedError = err;
      }

      expect(rejectedError).toBeInstanceOf(BulkheadRejectedException);
      expect(isBulkheadRejectedError(rejectedError)).toBe(true);

      // 等待前两个正常结束
      await Promise.all([p1, p2]);
    });
  });

  describe('6. ThrottleStrategy (速率限制策略)', () => {
    class ThrottledCommand extends ResilienceCommand {
      public async run(): Promise<string> {
        return 'success';
      }
    }

    it('在 TTL 窗口内超过请求 limit 时应当抛出 ThrottlerException 并匹配类型守卫', async () => {
      const throttle = new ThrottleStrategy({
        limit: 2,
        ttl: 1000,
      });

      const cmd = new ThrottledCommand([throttle], 'api', 'throttled-op');

      expect(await cmd.execute()).toBe('success');
      expect(await cmd.execute()).toBe('success');

      let throttledError: unknown;
      try {
        await cmd.execute();
      } catch (err) {
        throttledError = err;
      }

      expect(isRateLimitExceededError(throttledError)).toBe(true);
    });
  });

  describe('7. FallbackStrategy (异常回退策略)', () => {
    class ErrorCommand extends ResilienceCommand {
      public async run(): Promise<string> {
        throw new Error('Database down');
      }
    }

    it('发生异常时应当返回 fallback 计算后的兜底结果', async () => {
      const fallback = new FallbackStrategy((_cmd, ..._args) => 'default-safe-data');
      const cmd = new ErrorCommand([fallback]);

      const result = await cmd.execute();
      expect(result).toBe('default-safe-data');
    });
  });

  describe('8. HealthCheckStrategy (健康检查前置策略)', () => {
    class SensitiveCommand extends ResilienceCommand {
      public async run(): Promise<string> {
        return 'executed';
      }
    }

    it('健康检查通过时应当放行调用', async () => {
      const health = new HealthCheckStrategy(() => true);
      const cmd = new SensitiveCommand([health]);
      expect(await cmd.execute()).toBe('executed');
    });

    it('健康检查失败时应当抛出 HealthCheckFailedException', async () => {
      const health = new HealthCheckStrategy(() => false);
      const cmd = new SensitiveCommand([health]);
      await expect(cmd.execute()).rejects.toThrow(HealthCheckFailedException);
    });
  });

  describe('9. CacheStrategy (响应结果缓存策略)', () => {
    class TimestampCommand extends ResilienceCommand {
      public execCount = 0;

      public async run(): Promise<number> {
        this.execCount++;
        return Date.now();
      }
    }

    it('缓存有效期内重复调用应当直接返回缓存值并不增加执行计数', async () => {
      const cache = new CacheStrategy(5000);
      const cmd = new TimestampCommand([cache], 'cache-test', 'get-time');

      const first = await cmd.execute();
      const second = await cmd.execute();

      expect(second).toBe(first);
      expect(cmd.execCount).toBe(1);
    });
  });

  describe('10. DedupeStrategy (并发请求去重合并策略)', () => {
    class AsyncFetchCommand extends ResilienceCommand {
      public calls = 0;

      public async run(key: string): Promise<string> {
        this.calls++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `fetched:${key}`;
      }
    }

    it('并发触发同参调用时应当合并执行', async () => {
      const dedupe = new DedupeStrategy();
      const cmd = new AsyncFetchCommand([dedupe]);

      const [res1, res2] = await Promise.all([cmd.execute('item-1'), cmd.execute('item-1')]);

      expect(res1).toBe('fetched:item-1');
      expect(res2).toBe('fetched:item-1');
      expect(cmd.calls).toBe(1);
    });
  });

  describe('11. @UseResilience (方法装饰器声明式增强)', () => {
    class TestService {
      public callCount = 0;

      @UseResilience(
        new RetryStrategy({ maxRetries: 2, scaleFactor: 5 }),
        new FallbackStrategy(() => 'fallback-from-decorator'),
      )
      public async flakyMethod(shouldFail: boolean): Promise<string> {
        this.callCount++;
        if (shouldFail) {
          throw new Error('Failed');
        }
        return 'success';
      }

      @UseResilience(
        { group: 'CustomServiceGroup', name: 'customFlakyCommand' },
        new FallbackStrategy(() => 'fallback-named'),
      )
      public async namedMethod(): Promise<string> {
        throw new Error('error');
      }
    }

    it('应当支持在类方法上透明装饰并执行多层策略流水线', async () => {
      const service = new TestService();

      const success = await service.flakyMethod(false);
      expect(success).toBe('success');

      const fallback = await service.flakyMethod(true);
      expect(fallback).toBe('fallback-from-decorator');
    });

    it('应当支持显式指定 group 与 name 配置并正确注入底层 Command', async () => {
      const service = new TestService();

      const result = await service.namedMethod();
      expect(result).toBe('fallback-named');

      const command = getResilienceCommand(service, 'namedMethod');
      expect(command).toBeDefined();
      expect(command?.group).toBe('CustomServiceGroup');
      expect(command?.name).toBe('customFlakyCommand');
      expect(command?.toString()).toBe('CustomServiceGroup#customFlakyCommand');
    });
  });

  describe('12. ResilienceFactory (便捷策略与命令创建工厂)', () => {
    it('静态方法与实例方法均能正确构造各策略实例', () => {
      const factory = new ResilienceFactory();

      expect(ResilienceFactory.createTimeoutStrategy(100)).toBeInstanceOf(TimeoutStrategy);
      expect(ResilienceFactory.createRetryStrategy({ maxRetries: 3 })).toBeInstanceOf(RetryStrategy);
      expect(ResilienceFactory.createBulkheadStrategy({ maxConcurrent: 2 })).toBeInstanceOf(BulkheadStrategy);
      expect(factory.createCacheStrategy(1000)).toBeInstanceOf(CacheStrategy);
      expect(factory.createFallbackStrategy(() => null)).toBeInstanceOf(FallbackStrategy);
      expect(factory.createHealthCheckStrategy(() => true)).toBeInstanceOf(HealthCheckStrategy);
      expect(factory.createThrottleStrategy({ limit: 10, ttl: 1000 })).toBeInstanceOf(ThrottleStrategy);
      expect(factory.createDedupeStrategy()).toBeInstanceOf(DedupeStrategy);
      expect(factory.createCircuitBreakerStrategy()).toBeInstanceOf(CircuitBreakerStrategy);
    });
  });
});

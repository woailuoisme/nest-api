import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRateLimitExceededError,
  LocalTokenBucket,
  OutboundRateLimit,
  RateLimitExceededError,
  RateLimiterPolicy,
  type RedisProvider,
  ResilienceRegistryService,
} from '@/common/resilience';

describe('Outbound Rate Limiter (出站客户端配额限流与流量整形)', () => {
  describe('LocalTokenBucket (单机内存平滑令牌桶)', () => {
    it('场景 1: 桶内有令牌时立即获取成功', async () => {
      const bucket = new LocalTokenBucket(5, 1000);
      const start = Date.now();
      await bucket.acquire(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
      expect(bucket.availableTokens).toBeCloseTo(4, 0);
    });

    it('场景 2: 令牌耗尽且 maxWaitMs = 0 时立即抛出 RateLimitExceededError', async () => {
      const bucket = new LocalTokenBucket(2, 1000);
      await bucket.acquire(0);
      await bucket.acquire(0);

      await expect(bucket.acquire(0)).rejects.toThrow(RateLimitExceededError);
      try {
        await bucket.acquire(0);
      } catch (err) {
        expect(isRateLimitExceededError(err)).toBe(true);
        if (err instanceof RateLimitExceededError) {
          expect(err.limit).toBe(2);
          expect(err.windowMs).toBe(1000);
          expect(err.retryAfterMs).toBeGreaterThan(0);
        }
      }
    });

    it('场景 3: 令牌耗尽但在 maxWaitMs 允许范围内平滑排队并成功获取', async () => {
      const bucket = new LocalTokenBucket(1, 100);
      await bucket.acquire(0);

      const start = Date.now();
      // 等待 100ms 窗口补充令牌，maxWaitMs 允许 300ms
      await bucket.acquire(300);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(80);
    });

    it('场景 4: 令牌耗尽且所需排队时间超过 maxWaitMs 时抛出超额异常', async () => {
      const bucket = new LocalTokenBucket(1, 1000);
      await bucket.acquire(0);

      // 窗口需等待约 1000ms，但只允许等待 100ms
      await expect(bucket.acquire(100)).rejects.toThrow(RateLimitExceededError);
    });

    it('场景 5: 并发突发请求按顺序严格整形与排队，无竞态丢失', async () => {
      const bucket = new LocalTokenBucket(2, 200);
      const results: number[] = [];

      const tasks = [0, 1, 2].map(async (idx) => {
        await bucket.acquire(500);
        results.push(idx);
      });

      await Promise.all(tasks);
      expect(results.length).toBe(3);
    });

    it('场景 6: 经充分时间后令牌按速率自动平滑补满至容量上限', async () => {
      const bucket = new LocalTokenBucket(3, 100);
      await bucket.acquire(0);
      await bucket.acquire(0);
      await bucket.acquire(0);
      expect(bucket.availableTokens).toBeCloseTo(0, 0);

      // 休眠超过 100ms
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(bucket.availableTokens).toBeCloseTo(3, 0);
    });
  });

  describe('RateLimiterPolicy (策略包装器与双驱动适配)', () => {
    it('场景 7: Local 驱动正常执行业务函数并返回结果', async () => {
      const policy = new RateLimiterPolicy('test-service', { limit: 5, windowMs: 1000 });
      const result = await policy.execute(async () => 'success');
      expect(result).toBe('success');
      expect(policy.driver).toBe('local');
      expect(policy.limit).toBe(5);
      expect(policy.windowMs).toBe(1000);
    });

    it('场景 8: Local 驱动触发限流并触发 onRateLimited 监听器', async () => {
      const policy = new RateLimiterPolicy('listener-test', { limit: 1, windowMs: 1000, maxWaitMs: 0 });
      const onLimited = vi.fn();
      policy.onRateLimited(onLimited);

      await policy.execute(async () => 1);
      await expect(policy.execute(async () => 2)).rejects.toThrow(RateLimitExceededError);

      expect(onLimited).toHaveBeenCalledTimes(1);
      expect(onLimited.mock.calls[0][0]).toBeInstanceOf(RateLimitExceededError);
    });

    it('场景 9: Redis 驱动基于 Mock Redis 客户端成功执行 Lua 脚本并放行', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue(1),
      } as unknown as Redis;

      const policy = new RateLimiterPolicy('redis-service', { limit: 10, windowMs: 2000, driver: 'redis' }, mockRedis);

      const res = await policy.execute(async () => 'redis-ok');
      expect(res).toBe('redis-ok');
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('场景 10: Redis 驱动配额耗尽且允许 maxWaitMs 平滑排队等待后重试成功', async () => {
      const mockRedis = {
        eval: vi
          .fn()
          .mockResolvedValueOnce(-50) // 第一次返回 -50ms
          .mockResolvedValueOnce(1), // 排队重试后返回 1 (成功)
      } as unknown as Redis;

      const policy = new RateLimiterPolicy(
        'redis-queue',
        { limit: 5, windowMs: 1000, maxWaitMs: 200, driver: 'redis' },
        mockRedis,
      );

      const res = await policy.execute(async () => 'queued-ok');
      expect(res).toBe('queued-ok');
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    });

    it('场景 11: Redis 驱动配额耗尽且等待时间超过 maxWaitMs 抛出 RateLimitExceededError', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue(-500),
      } as unknown as Redis;

      const policy = new RateLimiterPolicy(
        'redis-reject',
        { limit: 5, windowMs: 1000, maxWaitMs: 100, driver: 'redis' },
        mockRedis,
      );

      await expect(policy.execute(async () => 'fail')).rejects.toThrow(RateLimitExceededError);
    });

    it('场景 12: Redis 服务异常崩溃时，自动平滑降级为本地内存令牌桶保护主流程', async () => {
      const mockRedis = {
        eval: vi.fn().mockRejectedValue(new Error('Connection lost to Redis')),
      } as unknown as Redis;

      const policy = new RateLimiterPolicy('redis-fallback', { limit: 5, windowMs: 1000, driver: 'redis' }, mockRedis);

      // 降级使用本地令牌桶成功执行
      const res = await policy.execute(async () => 'fallback-local');
      expect(res).toBe('fallback-local');
    });

    it('场景 13: 传入具备 getClient() 的 RedisProvider 容器对象可兼容获取 client', async () => {
      const mockRawRedis = {
        eval: vi.fn().mockResolvedValue(1),
      } as unknown as Redis;

      const mockRedisService: RedisProvider = {
        getClient: vi.fn().mockReturnValue(mockRawRedis),
      };

      const policy = new RateLimiterPolicy(
        'provider-test',
        { limit: 2, windowMs: 1000, driver: 'redis' },
        mockRedisService,
      );

      const res = await policy.execute(async () => 'provider-ok');
      expect(res).toBe('provider-ok');
      expect(mockRedisService.getClient).toHaveBeenCalled();
      expect(mockRawRedis.eval).toHaveBeenCalled();
    });
  });

  describe('@OutboundRateLimit (声明式出站限流方法装饰器)', () => {
    class ExternalApiClient {
      callCount = 0;

      @OutboundRateLimit({ limit: 2, windowMs: 500, maxWaitMs: 0 })
      async fetchUser(id: string): Promise<string> {
        this.callCount++;
        return `user-${id}`;
      }

      @OutboundRateLimit({
        limit: 1,
        windowMs: 500,
        maxWaitMs: 0,
        fallback: 'onRateLimitFallback',
      })
      async sensitiveApi(data: string): Promise<string> {
        return `done-${data}`;
      }

      @OutboundRateLimit({
        limit: 1,
        windowMs: 500,
        maxWaitMs: 0,
        fallback: (_err: unknown, param: string) => `closure-fallback-${param}`,
      })
      async closureApi(param: string): Promise<string> {
        return `primary-${param}`;
      }

      onRateLimitFallback(data: string, _error: unknown): string {
        return `fallback-${data}`;
      }
    }

    let client: ExternalApiClient;

    beforeEach(() => {
      ResilienceRegistryService.getShared().clear();
      client = new ExternalApiClient();
    });

    it('场景 14: 正常速率限制内调用透明放行执行', async () => {
      const res1 = await client.fetchUser('1');
      const res2 = await client.fetchUser('2');
      expect(res1).toBe('user-1');
      expect(res2).toBe('user-2');
      expect(client.callCount).toBe(2);
    });

    it('场景 15: 超过限流阈值且无 fallback 时抛出 RateLimitExceededError', async () => {
      await client.fetchUser('1');
      await client.fetchUser('2');
      await expect(client.fetchUser('3')).rejects.toThrow(RateLimitExceededError);
    });

    it('场景 16: 限流触发时自动路由至指定类方法 fallback', async () => {
      const first = await client.sensitiveApi('req1');
      expect(first).toBe('done-req1');

      // 第二次超限，命中 fallback 方法
      const second = await client.sensitiveApi('req2');
      expect(second).toBe('fallback-req2');
    });

    it('场景 17: 限流触发时自动路由至闭包函数 fallback', async () => {
      const first = await client.closureApi('item1');
      expect(first).toBe('primary-item1');

      // 第二次超限，命中闭包 fallback
      const second = await client.closureApi('item2');
      expect(second).toBe('closure-fallback-item2');
    });
  });

  describe('isRateLimitExceededError (错误类型守护判断工具)', () => {
    it('场景 18: 正确断言 RateLimitExceededError 实例与常规 Error 差异', () => {
      const rateLimitErr = new RateLimitExceededError('rate limit', 5, 1000, 200);
      const regularErr = new Error('generic error');

      expect(isRateLimitExceededError(rateLimitErr)).toBe(true);
      expect(isRateLimitExceededError(regularErr)).toBe(false);
      expect(isRateLimitExceededError(null)).toBe(false);
      expect(isRateLimitExceededError('string')).toBe(false);
    });
  });
});

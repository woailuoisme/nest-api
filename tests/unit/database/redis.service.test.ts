import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisService } from '@/database/redis.service';

describe('RedisService', () => {
  let redisService: RedisService;
  let mockRedisClient: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRedisClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      eval: vi.fn(),
      ping: vi.fn(),
    };
    redisService = new RedisService(mockRedisClient as any);
  });

  describe('withLock() — 分布式锁', () => {
    it('成功抢占锁后应执行业务逻辑，并在 finally 中通过 Lua 脚本原子释放', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const callback = vi.fn().mockResolvedValue('task-result');
      const result = await redisService.withLock('cron:token-cleanup', 5000, callback);

      expect(result).toBe('task-result');
      expect(mockRedisClient.set).toHaveBeenCalledWith('lock:cron:token-cleanup', expect.any(String), 'PX', 5000, 'NX');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'lock:cron:token-cleanup',
        expect.any(String),
      );
    });

    it('未抢占到锁时应短路返回 null，不执行回调', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      const callback = vi.fn();
      const result = await redisService.withLock('cron:token-cleanup', 5000, callback);

      expect(result).toBeNull();
      expect(callback).not.toHaveBeenCalled();
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('业务抛出异常时仍确保在 finally 中释放锁', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const callback = vi.fn().mockRejectedValue(new Error('Job Crashed'));

      await expect(redisService.withLock('cron:token-cleanup', 5000, callback)).rejects.toThrow('Job Crashed');
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
    });

    it('临界区执行超过 ttl/3 时应自动续租，避免锁提前过期导致互斥失效', async () => {
      vi.useFakeTimers();
      try {
        mockRedisClient.set.mockResolvedValue('OK');
        mockRedisClient.eval.mockResolvedValue(1);

        const callback = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 5000)));
        const pending = redisService.withLock('cron:token-cleanup', 9000, callback);

        // ttlMs / 3 = 3000ms 时触发续租（5 个参数：脚本、键数、键、token、ttl）
        await vi.advanceTimersByTimeAsync(3000);
        expect(mockRedisClient.eval).toHaveBeenCalledWith(
          expect.stringContaining('pexpire'),
          1,
          'lock:cron:token-cleanup',
          expect.any(String),
          9000,
        );

        await vi.advanceTimersByTimeAsync(2000);
        await expect(pending).resolves.toBe('done');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('remember() — 自动缓存读写', () => {
    it('命中缓存时直接解析 JSON 返回，不调用 fetcher', async () => {
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ name: 'cached-user' }));

      const fetcher = vi.fn();
      const result = await redisService.remember('user:1', 60, fetcher);

      expect(result).toEqual({ name: 'cached-user' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('未命中缓存时执行 fetcher 并写回 Redis', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValue('OK');

      const fetcher = vi.fn().mockResolvedValue({ name: 'fresh-user' });
      const result = await redisService.remember('user:1', 60, fetcher);

      expect(result).toEqual({ name: 'fresh-user' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.set).toHaveBeenCalledWith('user:1', JSON.stringify({ name: 'fresh-user' }), 'EX', 60);
    });
  });

  describe('基础代理方法', () => {
    it('应透传 get / set / del / exists / ping', async () => {
      mockRedisClient.get.mockResolvedValue('val');
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.exists.mockResolvedValue(1);
      mockRedisClient.ping.mockResolvedValue('PONG');

      expect(await redisService.get('k')).toBe('val');
      expect(await redisService.set('k', 'v', 10)).toBe('OK');
      expect(await redisService.del('k')).toBe(1);
      expect(await redisService.exists('k')).toBe(1);
      expect(await redisService.ping()).toBe('PONG');
      expect(redisService.getClient()).toBe(mockRedisClient);
    });

    it('key() 应正确拼接统一命名空间与分段', () => {
      expect(redisService.key('user', 123)).toBe('user:123');
      expect(redisService.key('cache', 'auth', 'token', 456)).toBe('cache:auth:token:456');
    });
  });
});

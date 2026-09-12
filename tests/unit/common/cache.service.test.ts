import type { Cache } from 'cache-manager';
import type Redis from 'ioredis';
import type Keyv from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_INVALIDATE_CHANNEL,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_NULL_CACHE_TTL_MS,
  NULL_CACHE_SENTINEL,
} from '@/common/cache/cache.constants.js';
import type { CacheInvalidateMessage } from '@/common/cache/cache.interfaces.js';
import { CacheService, calculateJitterTtl } from '@/common/cache/cache.service.js';

describe('CacheService 统一缓存门面服务', () => {
  let cacheService: CacheService;
  let mockCacheManager: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let mockRedisClient: {
    publish: ReturnType<typeof vi.fn>;
    duplicate: ReturnType<typeof vi.fn>;
  };
  let mockSubClient: {
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  let mockL1Store: {
    delete: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let messageHandler: ((channel: string, message: string) => void) | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    messageHandler = undefined;

    mockCacheManager = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      clear: vi.fn(),
    };

    mockSubClient = {
      subscribe: vi.fn().mockResolvedValue(1),
      on: vi.fn((event: string, handler: (channel: string, message: string) => void) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      }),
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    };

    mockRedisClient = {
      publish: vi.fn().mockResolvedValue(1),
      duplicate: vi.fn().mockReturnValue(mockSubClient),
    };

    mockL1Store = {
      delete: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    cacheService = new CacheService(
      mockCacheManager as unknown as Cache,
      mockRedisClient as unknown as Redis,
      mockL1Store as unknown as Keyv,
    );
  });

  describe('calculateJitterTtl 防雪崩抖动函数', () => {
    it('当 ratio <= 0 时应返回原始 TTL', () => {
      expect(calculateJitterTtl(60000, 0)).toBe(60000);
      expect(calculateJitterTtl(60000, -0.1)).toBe(60000);
    });

    it('当 ratio > 0 时返回在抖动范围内的有效整数 TTL', () => {
      const base = 10000;
      const ratio = 0.1; // ±10%: [9000, 11000]
      for (let i = 0; i < 50; i++) {
        const jittered = calculateJitterTtl(base, ratio);
        expect(jittered).toBeGreaterThanOrEqual(9000);
        expect(jittered).toBeLessThanOrEqual(11000);
        expect(Number.isInteger(jittered)).toBe(true);
      }
    });
  });

  describe('基础读写与删除方法 (get, set, del, reset)', () => {
    it('get: 未命中或返回 null 时应统一返回 undefined', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      expect(await cacheService.get('missed_key')).toBeUndefined();

      mockCacheManager.get.mockResolvedValueOnce(null);
      expect(await cacheService.get('missed_key_2')).toBeUndefined();
    });

    it('get: 命中 NULL_CACHE_SENTINEL 哨兵时应返回 null（防穿透命中）', async () => {
      mockCacheManager.get.mockResolvedValueOnce(NULL_CACHE_SENTINEL);
      const result = await cacheService.get('empty_row');
      expect(result).toBeNull();
    });

    it('get: 正常命中时应返回对应的数据', async () => {
      const mockData = { id: 'usr-1', name: 'Alice' };
      mockCacheManager.get.mockResolvedValueOnce(mockData);

      const result = await cacheService.get<typeof mockData>('usr:1');
      expect(result).toEqual(mockData);
    });

    it('set: 写入缓存时应支持自定义 TTL 与默认 TTL', async () => {
      await cacheService.set('key1', 'val1');
      expect(mockCacheManager.set).toHaveBeenCalledWith('key1', 'val1', DEFAULT_CACHE_TTL_MS);

      await cacheService.set('key2', 'val2', 120000);
      expect(mockCacheManager.set).toHaveBeenCalledWith('key2', 'val2', 120000);
    });

    it('del: 删除缓存项时应同步删除 L1 并发布集群广播', async () => {
      await cacheService.del('usr:1');

      expect(mockCacheManager.del).toHaveBeenCalledWith('usr:1');
      expect(mockL1Store.delete).toHaveBeenCalledWith('usr:1');
      expect(mockRedisClient.publish).toHaveBeenCalledWith(
        CACHE_INVALIDATE_CHANNEL,
        expect.stringContaining('"key":"usr:1"'),
      );
    });

    it('reset: 清空全部缓存时应调用 L1 clear 与广播 key = *', async () => {
      await cacheService.reset();

      expect(mockL1Store.clear).toHaveBeenCalled();
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(mockRedisClient.publish).toHaveBeenCalledWith(
        CACHE_INVALIDATE_CHANNEL,
        expect.stringContaining('"key":"*"'),
      );
    });
  });

  describe('remember() 高并发与工业级三防机制', () => {
    it('缓存已存在时直接返回，不触发 fetcher 回源', async () => {
      mockCacheManager.get.mockResolvedValueOnce('cached-value');
      const fetcher = vi.fn().mockResolvedValue('fresh-value');

      const result = await cacheService.remember('order:100', 30000, fetcher);

      expect(result).toBe('cached-value');
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('缓存未命中时回源并写入缓存（带 Jitter 随机时间抖动）', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      const fetcher = vi.fn().mockResolvedValue({ id: 123, status: 'paid' });

      const result = await cacheService.remember('order:123', 10000, fetcher, {
        jitterRatio: 0.1,
      });

      expect(result).toEqual({ id: 123, status: 'paid' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith('order:123', { id: 123, status: 'paid' }, expect.any(Number));

      const actualTtl = mockCacheManager.set.mock.calls[0]?.[2] as number;
      expect(actualTtl).toBeGreaterThanOrEqual(9000);
      expect(actualTtl).toBeLessThanOrEqual(11000);
    });

    it('Singleflight 并发互斥：同一时刻并发多次请求，底层 fetcher 仅执行 1 次（防击穿）', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      let executionCount = 0;
      const delayedFetcher = vi.fn(async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { data: 'heavy-query-result' };
      });

      // 模拟 10 个并发调用
      const concurrentCalls = Array.from({ length: 10 }).map(() =>
        cacheService.remember('hot-key', 60000, delayedFetcher),
      );

      const results = await Promise.all(concurrentCalls);

      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res).toEqual({ data: 'heavy-query-result' });
      }

      // 关键断言：fetcher 仅执行 1 次！
      expect(executionCount).toBe(1);
      expect(delayedFetcher).toHaveBeenCalledTimes(1);
    });

    it('空值防穿透：fetcher 返回 null 时以短 TTL 缓存哨兵并返回 null', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      const nullFetcher = vi.fn().mockResolvedValue(null);

      const result = await cacheService.remember('non-existent-user', 60000, nullFetcher, {
        cacheNull: true,
        nullTtlMs: 5000,
      });

      expect(result).toBeNull();
      expect(nullFetcher).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith('non-existent-user', NULL_CACHE_SENTINEL, 5000);
    });

    it('空值防穿透：当 cacheNull 为 false 时，不缓存哨兵', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      const nullFetcher = vi.fn().mockResolvedValue(undefined);

      const result = await cacheService.remember('temp-empty', 60000, nullFetcher, {
        cacheNull: false,
      });

      expect(result).toBeUndefined();
      expect(nullFetcher).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('fetcher 抛出异常时 Singleflight 互斥池能正确清理，不影响后续调用', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const failingFetcher = vi.fn().mockRejectedValue(new Error('DB Connection Failed'));

      await expect(cacheService.remember('error-key', 60000, failingFetcher)).rejects.toThrow('DB Connection Failed');

      // 后续调用恢复正常
      const recoverFetcher = vi.fn().mockResolvedValue('recovered');
      const recoveredResult = await cacheService.remember('error-key', 60000, recoverFetcher);

      expect(recoveredResult).toBe('recovered');
      expect(recoverFetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('跨节点 Pub/Sub 广播与 L1 失效联动', () => {
    it('模块初始化与销毁生命周期正确绑定 Pub/Sub 连接', async () => {
      expect(cacheService.isSubscribedToCluster).toBe(false);
      await cacheService.onModuleInit();
      expect(mockRedisClient.duplicate).toHaveBeenCalledTimes(1);
      expect(mockSubClient.subscribe).toHaveBeenCalledWith(CACHE_INVALIDATE_CHANNEL);
      expect(cacheService.isSubscribedToCluster).toBe(true);

      await cacheService.onModuleDestroy();
      expect(mockSubClient.quit).toHaveBeenCalledTimes(1);
      expect(cacheService.isSubscribedToCluster).toBe(false);
    });

    it('收到本节点发布的广播时应自动忽略，防止自环递归驱逐', async () => {
      await cacheService.onModuleInit();
      expect(messageHandler).toBeDefined();

      const selfMessage: CacheInvalidateMessage = {
        originInstanceId: cacheService.instanceId,
        key: 'usr:123',
        timestamp: Date.now(),
      };

      messageHandler!(CACHE_INVALIDATE_CHANNEL, JSON.stringify(selfMessage));

      expect(mockL1Store.delete).not.toHaveBeenCalled();
      expect(mockL1Store.clear).not.toHaveBeenCalled();
    });

    it('收到其他节点的单 Key 失效广播时，精确删除本地 L1 对应 Key', async () => {
      await cacheService.onModuleInit();
      expect(messageHandler).toBeDefined();

      const remoteMessage: CacheInvalidateMessage = {
        originInstanceId: 'remote-instance-abc',
        key: 'usr:456',
        timestamp: Date.now(),
      };

      messageHandler!(CACHE_INVALIDATE_CHANNEL, JSON.stringify(remoteMessage));

      expect(mockL1Store.delete).toHaveBeenCalledWith('usr:456');
    });

    it('收到其他节点的全量失效广播时 (key = *)，清空本地全部 L1 缓存', async () => {
      await cacheService.onModuleInit();
      expect(messageHandler).toBeDefined();

      const remoteClearMessage: CacheInvalidateMessage = {
        originInstanceId: 'remote-instance-abc',
        key: '*',
        timestamp: Date.now(),
      };

      messageHandler!(CACHE_INVALIDATE_CHANNEL, JSON.stringify(remoteClearMessage));

      expect(mockL1Store.clear).toHaveBeenCalledTimes(1);
    });

    it('收到非 JSON 格式的消息时安全捕获并打印 warn，不引起进程崩溃', async () => {
      await cacheService.onModuleInit();
      expect(messageHandler).toBeDefined();

      expect(() => {
        messageHandler!(CACHE_INVALIDATE_CHANNEL, 'invalid-non-json-message');
      }).not.toThrow();

      expect(mockL1Store.delete).not.toHaveBeenCalled();
    });
  });
});

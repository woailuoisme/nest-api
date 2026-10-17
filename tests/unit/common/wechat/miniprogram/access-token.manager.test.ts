import type { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessTokenManager, MemoryMiniprogramTokenCache } from '@/common/wechat/miniprogram/access-token.manager';
import type { MiniprogramTokenCache } from '@/common/wechat/miniprogram/drivers/miniprogram-driver.interface';
import { MiniprogramException } from '@/common/wechat/miniprogram/miniprogram.exception';

const APP_ID = 'wx-test-appid';
/** 官方提前续期窗口：缓存剩余有效期不足该值时需续期 */
const SAFETY_WINDOW_SECONDS = 300;

/** 静默 Logger：避免用例输出被驱动的日志刷屏 */
function createSilentLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

/** 带互斥能力的测试缓存：用进程内标志模拟 Redis 的 SET NX 语义 */
class LockingTestCache implements MiniprogramTokenCache {
  private readonly store = new Map<string, string>();
  private locked = false;
  /** 未抢到锁的次数，用于断言走了「复用持锁者结果」的回退分支 */
  lockMisses = 0;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async withLock<T>(_key: string, _ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    if (this.locked) {
      this.lockMisses += 1;
      return null;
    }
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
    }
  }
}

/** 构造可观测的凭证获取器 */
function createFetcher(expiresIn = 7200) {
  return vi.fn(async (forceRefresh: boolean) => ({
    accessToken: forceRefresh ? 'FORCED_TOKEN' : 'FRESH_TOKEN',
    expiresIn,
  }));
}

/** 构造管理器 */
function createManager(fetcher: ReturnType<typeof createFetcher>, cache?: MiniprogramTokenCache) {
  return new AccessTokenManager({
    appid: APP_ID,
    fetcher,
    logger: createSilentLogger(),
    ...(cache ? { cache } : {}),
    safetyWindowSeconds: SAFETY_WINDOW_SECONDS,
  });
}

describe('微信小程序 access_token 管理器', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('缓存未命中时应回源并写入缓存，命中后不再回源', async () => {
    const fetcher = createFetcher();
    const cache = new MemoryMiniprogramTokenCache();
    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');
    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(false);
  });

  it('剩余有效期落入续期窗口时应视为失效并回源', async () => {
    const fetcher = createFetcher();
    const cache = new MemoryMiniprogramTokenCache();
    // 剩余 100 秒 < 续期窗口 300 秒，属于视为失效的区间
    await cache.set(
      `wechat:miniprogram:access_token:${APP_ID}`,
      JSON.stringify({ accessToken: 'STALE_TOKEN', expiresAt: Date.now() + 100_000 }),
      100,
    );

    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('剩余有效期充裕时应直接命中缓存', async () => {
    const fetcher = createFetcher();
    const cache = new MemoryMiniprogramTokenCache();
    await cache.set(
      `wechat:miniprogram:access_token:${APP_ID}`,
      JSON.stringify({ accessToken: 'CACHED_TOKEN', expiresAt: Date.now() + 3600_000 }),
      3600,
    );

    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('CACHED_TOKEN');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refreshToken 应绕过缓存强制回源', async () => {
    const fetcher = createFetcher();
    const cache = new MemoryMiniprogramTokenCache();
    await cache.set(
      `wechat:miniprogram:access_token:${APP_ID}`,
      JSON.stringify({ accessToken: 'CACHED_TOKEN', expiresAt: Date.now() + 3600_000 }),
      3600,
    );

    const manager = createManager(fetcher, cache);

    await expect(manager.refreshToken()).resolves.toBe('FORCED_TOKEN');
    expect(fetcher).toHaveBeenCalledWith(true);
    // 强刷结果应写回缓存，供后续请求复用
    await expect(manager.getToken()).resolves.toBe('FORCED_TOKEN');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('并发获取凭证时应通过分布式锁避免并发击穿', async () => {
    const fetcher = createFetcher();
    const cache = new LockingTestCache();
    const manager = createManager(fetcher, cache);

    const [first, second] = await Promise.all([manager.getToken(), manager.getToken()]);

    expect(first).toBe('FRESH_TOKEN');
    expect(second).toBe('FRESH_TOKEN');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.lockMisses).toBe(1);
  });

  it('未抢到锁且持有人未写入缓存时仍应兜底回源，保证可用性', async () => {
    const fetcher = createFetcher();
    // 始终抢不到锁，且缓存为空：应退化为直接回源而非报错
    const cache: MiniprogramTokenCache = {
      get: async () => null,
      set: async () => 'OK',
      withLock: async () => null,
    };
    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('缓存读失败或锁不可用均不应阻断凭证获取', async () => {
    const fetcher = createFetcher();
    const cache: MiniprogramTokenCache = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
      withLock: async () => {
        throw new Error('redis down');
      },
    };
    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');
  });

  it('缓存内容损坏时应重新回源而非抛出解析错误', async () => {
    const fetcher = createFetcher();
    const cache = new MemoryMiniprogramTokenCache();
    await cache.set(`wechat:miniprogram:access_token:${APP_ID}`, 'not-json', 3600);

    const manager = createManager(fetcher, cache);

    await expect(manager.getToken()).resolves.toBe('FRESH_TOKEN');
  });

  it('应答缺少 access_token 时应按上游异常上报', async () => {
    const manager = createManager(vi.fn(async () => ({ accessToken: '', expiresIn: 7200 })));

    await expect(manager.getToken()).rejects.toBeInstanceOf(MiniprogramException);
    await expect(manager.getToken()).rejects.toMatchObject({ miniprogramCode: 'MINIPROGRAM_TOKEN_MISSING' });
  });

  it('不同 appid 的凭证互不串用', async () => {
    const cache = new MemoryMiniprogramTokenCache();
    const firstFetcher = vi.fn(async () => ({ accessToken: 'TOKEN_A', expiresIn: 7200 }));
    const secondFetcher = vi.fn(async () => ({ accessToken: 'TOKEN_B', expiresIn: 7200 }));

    const first = new AccessTokenManager({
      appid: 'wx-app-a',
      fetcher: firstFetcher,
      cache,
      logger: createSilentLogger(),
    });
    const second = new AccessTokenManager({
      appid: 'wx-app-b',
      fetcher: secondFetcher,
      cache,
      logger: createSilentLogger(),
    });

    await expect(first.getToken()).resolves.toBe('TOKEN_A');
    await expect(second.getToken()).resolves.toBe('TOKEN_B');
    await expect(first.getToken()).resolves.toBe('TOKEN_A');
    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(secondFetcher).toHaveBeenCalledTimes(1);
  });
});

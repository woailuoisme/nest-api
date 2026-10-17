/**
 * RedisThrottlerStorage 真实 Redis 集成测试
 *
 * 单元测试把脚本调用整体 mock 掉，只能验证 TS 侧映射；本文件直接驱动真实实现（含 Lua 脚本本体），
 * 覆盖固定窗口不续期、超限封禁、封禁期内不自增与 blockDuration=0 四条路径。
 *
 * 目标 Redis 取自 `REDIS_URL`（缺失时回退本机默认地址）；**不可达时整体跳过**，可安全留在默认单元测试集。
 * 读取 `.env` 使用 `dotenv.parse` 而非 `dotenv/config`：不修改 `process.env`，避免污染同 worker 内其他用例。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { ThrottlerStorageService } from '@nestjs/throttler';
import { parse } from 'dotenv';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisThrottlerStorage } from '@/common/throttler/redis-throttler-storage';

const envFile = existsSync('.env') ? parse(readFileSync('.env')) : {};
const REDIS_URL = process.env.REDIS_URL ?? envFile.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
const THROTTLER_NAME = 'itest';
const KEY_PATTERN = `throttle:*${THROTTLER_NAME}:*`;

/** 探测真实 Redis；不可达返回 null（用例整体跳过，不使默认测试集失败） */
async function connectRedis(): Promise<Redis | null> {
  const client = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 500 });
  try {
    await client.connect();
    await client.ping();
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}

const redis = await connectRedis();

describe.skipIf(!redis)('RedisThrottlerStorage（真实 Redis 集成）', () => {
  const client = redis as Redis;
  let storage: RedisThrottlerStorage;

  /** 每个用例使用独立键名，避免相互干扰 */
  const newKey = (caseName: string) => `${caseName}-${randomUUID()}`;

  beforeAll(() => {
    storage = new RedisThrottlerStorage(client, new ThrottlerStorageService());
  });

  afterAll(async () => {
    const keys = await client.keys(KEY_PATTERN);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    await client.quit();
  });

  it('固定窗口：首次命中设置过期，后续命中不续期（避免永不限流）', async () => {
    const key = newKey('window');

    const first = await storage.increment(key, 60_000, 10, 0, THROTTLER_NAME);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = await storage.increment(key, 60_000, 10, 0, THROTTLER_NAME);

    expect(first).toMatchObject({ totalHits: 1, timeToExpire: 60, isBlocked: false });
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false });
    // 若第二次调用续期，PTTL 会回到 ~60000；此处必须严格小于首次（证明固定窗口语义）
    expect(second.timeToExpire).toBeLessThanOrEqual(first.timeToExpire);

    const pttl = await client.pttl(`throttle:${THROTTLER_NAME}:${key}`);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });

  it('超限封禁：超过 limit 后进入封禁期，且封禁期内不再自增计数', async () => {
    const key = newKey('block');

    const first = await storage.increment(key, 60_000, 2, 5_000, THROTTLER_NAME);
    const second = await storage.increment(key, 60_000, 2, 5_000, THROTTLER_NAME);
    const third = await storage.increment(key, 60_000, 2, 5_000, THROTTLER_NAME);
    const fourth = await storage.increment(key, 60_000, 2, 5_000, THROTTLER_NAME);

    expect([first.isBlocked, second.isBlocked]).toEqual([false, false]);
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(third.timeToBlockExpire).toBeGreaterThan(0);
    expect(third.timeToBlockExpire).toBeLessThanOrEqual(5);
    // 封禁期内不再 INCR：命中数保持不变
    expect(fourth).toMatchObject({ totalHits: 3, isBlocked: true });

    const blockPttl = await client.pttl(`throttle:block:${THROTTLER_NAME}:${key}`);
    expect(blockPttl).toBeGreaterThan(0);
  });

  it('blockDuration=0（未配置封禁时长）时以窗口剩余时间作为重试窗口，且不创建封禁键', async () => {
    const key = newKey('no-block');

    const first = await storage.increment(key, 60_000, 1, 0, THROTTLER_NAME);
    const second = await storage.increment(key, 60_000, 1, 0, THROTTLER_NAME);

    expect(first.isBlocked).toBe(false);
    expect(second).toMatchObject({ totalHits: 2, isBlocked: true, timeToExpire: 60 });
    expect(second.timeToBlockExpire).toBeGreaterThan(0);
    expect(await client.exists(`throttle:block:${THROTTLER_NAME}:${key}`)).toBe(0);
  });

  it('键空间与业务缓存隔离：计数键位于 throttle: 命名空间且带有 TTL', async () => {
    const key = newKey('namespace');

    await storage.increment(key, 30_000, 10, 0, THROTTLER_NAME);

    const counterKey = `throttle:${THROTTLER_NAME}:${key}`;
    expect(await client.get(counterKey)).toBe('1');
    expect(await client.pttl(counterKey)).toBeGreaterThan(0);
  });
});

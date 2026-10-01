import { ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from '@/common/throttler/redis-throttler-storage';
import { createThrottlerStorage } from '@/common/throttler/throttler-storage.module';

/** 仅作为构造依赖传入，memory 驱动不应触达它 */
const redisStub = { defineCommand: vi.fn(), status: 'ready' } as unknown as Redis;

describe('createThrottlerStorage（THROTTLE_STORAGE 驱动选择）', () => {
  it("driver='redis' 返回跨副本共享存储", () => {
    const memory = new ThrottlerStorageService();

    const storage = createThrottlerStorage('redis', memory, redisStub);

    expect(storage).toBeInstanceOf(RedisThrottlerStorage);
  });

  it("driver='memory' 直接复用进程内存储且不注册脚本（本地无 Redis 场景）", () => {
    const memory = new ThrottlerStorageService();

    const storage = createThrottlerStorage('memory', memory, redisStub);

    expect(storage).toBe(memory);
    expect(redisStub.defineCommand).not.toHaveBeenCalled();
  });

  it('memory 驱动的计数语义可用：limit=1 时第二次即封禁', async () => {
    const storage = createThrottlerStorage('memory', new ThrottlerStorageService(), redisStub);

    const first = await storage.increment('client-a', 60_000, 1, 60_000, 'default');
    const second = await storage.increment('client-a', 60_000, 1, 60_000, 'default');

    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(true);
  });
});

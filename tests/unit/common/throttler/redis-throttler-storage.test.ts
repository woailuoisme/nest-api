import { Logger } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from '@/common/throttler/redis-throttler-storage';

/** 脚本调用入参：`[counterKey, blockKey, ttl, limit, blockDuration]` */
type ScriptCall = [string, string, number, number, number];

/** 构造被测存储与其依赖的 ioredis 桩（`status` 可指定以覆盖各就绪状态） */
function createStorage(options: { status?: string } = {}) {
  const throttleIncrement = vi.fn<(...args: ScriptCall) => Promise<number[]>>();
  const defineCommand = vi.fn();
  const redisMock = {
    defineCommand,
    throttleIncrement,
    status: options.status ?? 'ready',
  } as unknown as Redis;
  const fallback = new ThrottlerStorageService();

  return {
    storage: new RedisThrottlerStorage(redisMock, fallback),
    fallback,
    throttleIncrement,
    defineCommand,
  };
}

describe('RedisThrottlerStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('注册 Lua 脚本时声明 2 个键并以 INCR 达成原子计数', () => {
    const { defineCommand } = createStorage();

    expect(defineCommand).toHaveBeenCalledTimes(1);
    const [name, definition] = defineCommand.mock.calls[0] as [string, { numberOfKeys: number; lua: string }];
    expect(name).toBe('throttleIncrement');
    expect(definition.numberOfKeys).toBe(2);
    expect(definition.lua).toContain('INCR');
    expect(definition.lua).toContain('PEXPIRE');
  });

  it('正常计数：键按 throttlerName 命名空间隔离，且剩余时间由毫秒换算为秒', async () => {
    const { storage, throttleIncrement } = createStorage();
    throttleIncrement.mockResolvedValue([3, 5000, 0, 0]);

    const record = await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

    expect(throttleIncrement).toHaveBeenCalledWith(
      'throttle:default:1.2.3.4',
      'throttle:block:default:1.2.3.4',
      60_000,
      100,
      0,
    );
    expect(record).toEqual({ totalHits: 3, timeToExpire: 5, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('命中封禁：封禁期内返回封禁剩余秒数供 Retry-After 使用', async () => {
    const { storage, throttleIncrement } = createStorage();
    throttleIncrement.mockResolvedValue([101, 30_000, 1, 60_000]);

    const record = await storage.increment('1.2.3.4', 60_000, 100, 60_000, 'default');

    expect(record).toEqual({ totalHits: 101, timeToExpire: 30, isBlocked: true, timeToBlockExpire: 60 });
  });

  it('窗口与封禁剩余时间均向下取整到 0（不出现负值）', async () => {
    const { storage, throttleIncrement } = createStorage();
    throttleIncrement.mockResolvedValue([1, 0, 0, 0]);

    const record = await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

    expect(record).toEqual({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('Redis 故障时降级为进程内计数并告警（限流抖动不得演化为请求失败）', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const { storage, throttleIncrement } = createStorage();
    throttleIncrement.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    const first = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default');
    const second = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default');
    const third = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default');

    // 进程内兜底仍生效：limit=2 时第 3 次进入封禁
    expect([first.isBlocked, second.isBlocked, third.isBlocked]).toEqual([false, false, true]);
    expect(third.totalHits).toBe(3);

    const degradedWarnings = warnSpy.mock.calls.filter(([message]) => String(message).includes('限流共享存储不可用'));
    expect(degradedWarnings).toHaveLength(1);
    // 告警不得泄漏限流键（键内含客户端标识）
    expect(String(degradedWarnings[0][0])).not.toContain('1.2.3.4');
  });

  it('Redis 恢复后输出一次性 info 并回到共享计数', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    const { storage, throttleIncrement } = createStorage();
    throttleIncrement.mockRejectedValueOnce(new Error('READONLY'));
    throttleIncrement.mockResolvedValue([1, 1000, 0, 0]);

    await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');
    const recovered = await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

    expect(recovered).toEqual({ totalHits: 1, timeToExpire: 1, isBlocked: false, timeToBlockExpire: 0 });
    expect(logSpy.mock.calls.filter(([message]) => String(message).includes('限流共享存储已恢复'))).toHaveLength(1);
  });

  it('降级路径使用命名空间后的键，避免与业务缓存键冲撞', async () => {
    const { storage, fallback, throttleIncrement } = createStorage();
    throttleIncrement.mockRejectedValue(new Error('boom'));
    const incrementSpy = vi.spyOn(fallback, 'increment');

    await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

    expect(incrementSpy).toHaveBeenCalledWith('throttle:default:1.2.3.4', 60_000, 100, 0, 'default');
  });

  describe('时间上界与客户端就绪状态（避免请求被依赖抖动拖慢）', () => {
    it("status='wait'（lazyConnect 冷启动）必须放行并调用脚本，否则永远不建连 → 永久降级", async () => {
      const { storage, throttleIncrement } = createStorage({ status: 'wait' });
      throttleIncrement.mockResolvedValue([1, 60_000, 0, 0]);

      const record = await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

      expect(throttleIncrement).toHaveBeenCalledTimes(1);
      expect(record.totalHits).toBe(1);
    });

    it.each(['reconnecting', 'close', 'end', 'connecting'])(
      "status='%s' 时立即降级，命令不进入离线队列等待",
      async (status) => {
        const { storage, throttleIncrement } = createStorage({ status });
        throttleIncrement.mockResolvedValue([99, 60_000, 0, 0]);

        const record = await storage.increment('1.2.3.4', 60_000, 100, 60_000, 'default');

        expect(throttleIncrement).not.toHaveBeenCalled();
        // 仅断言兜底语义：非封禁分支下内置存储的 timeToBlockExpire 为库内负值（未被守卫消费），不作契约
        expect(record).toMatchObject({ totalHits: 1, timeToExpire: 60, isBlocked: false });
      },
    );

    it('客户端就绪但响应超出时间上界时降级，单请求耗时有界', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      const { storage, throttleIncrement } = createStorage();
      // 永不 resolve，模拟就绪状态下的依赖挂起
      throttleIncrement.mockImplementation(() => new Promise<number[]>(() => {}));

      const startedAt = Date.now();
      const record = await storage.increment('1.2.3.4', 60_000, 100, 60_000, 'default');
      const elapsed = Date.now() - startedAt;

      expect(record).toMatchObject({ totalHits: 1, timeToExpire: 60, isBlocked: false });
      expect(elapsed).toBeLessThan(2000);
      expect(warnSpy.mock.calls.some(([message]) => String(message).includes('限流共享存储响应超时'))).toBe(true);
    });
  });
});

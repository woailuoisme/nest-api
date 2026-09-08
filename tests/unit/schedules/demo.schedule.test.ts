/**
 * DemoSchedule 单元测试
 *
 * 覆盖：testing 环境跳过注册；非 testing 环境调用 upsertJobScheduler 注册每分钟 tick，
 * 并投递延迟 30 秒的演示 job。
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvConfig } from '@/config/env.validation';
import { DemoJobName } from '@/jobs/demo/demo.jobs';
import { DemoSchedule } from '@/schedules/demo.schedule';

describe('DemoSchedule', () => {
  let schedule: DemoSchedule;
  let queue: Queue;

  /** 构造指定 APP_ENV 的 schedule 实例 */
  function createSchedule(appEnv: string): DemoSchedule {
    const config = { get: vi.fn().mockReturnValue(appEnv) } as unknown as ConfigService<EnvConfig, true>;
    return new DemoSchedule(queue, config);
  }

  beforeEach(() => {
    queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
  });

  describe('onApplicationBootstrap()', () => {
    it('testing 环境应跳过注册，不触碰队列', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      schedule = createSchedule('testing');

      await schedule.onApplicationBootstrap();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Demo schedule disabled'));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('非 testing 环境应注册每分钟 tick 并投递延迟 30s 演示 job', async () => {
      schedule = createSchedule('production');

      await schedule.onApplicationBootstrap();

      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'every-minute-demo-tick',
        { pattern: '* * * * *' },
        expect.objectContaining({ name: DemoJobName.Tick, data: { message: 'every-minute tick' } }),
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(DemoJobName.Delayed, { message: 'delayed at boot' }, { delay: 30_000 });
    });
  });
});

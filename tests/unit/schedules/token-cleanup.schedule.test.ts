/**
 * TokenCleanupSchedule 单元测试
 *
 * 覆盖：testing 环境跳过注册；非 testing 环境调用 upsertJobScheduler 注册每日凌晨 3 点清理任务。
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvConfig } from '@/config/env.validation';
import { TokenCleanupJobName } from '@/jobs/token-cleanup/token-cleanup.jobs';
import { TokenCleanupSchedule } from '@/schedules/token-cleanup.schedule';

describe('TokenCleanupSchedule', () => {
  let schedule: TokenCleanupSchedule;
  let queue: Queue;

  function createSchedule(appEnv: string): TokenCleanupSchedule {
    const config = { get: vi.fn().mockReturnValue(appEnv) } as unknown as ConfigService<EnvConfig, true>;
    return new TokenCleanupSchedule(queue, config);
  }

  beforeEach(() => {
    queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
  });

  describe('onApplicationBootstrap()', () => {
    it('testing 环境应跳过注册，不触碰队列', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      schedule = createSchedule('testing');

      await schedule.onApplicationBootstrap();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Token cleanup schedule disabled'));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('非 testing 环境应注册每日凌晨 3 点清理任务', async () => {
      schedule = createSchedule('production');

      await schedule.onApplicationBootstrap();

      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'daily-token-cleanup',
        { pattern: '0 3 * * *' },
        expect.objectContaining({
          name: TokenCleanupJobName.PurgeExpired,
          data: { batchSize: 1000 },
        }),
      );
    });
  });
});

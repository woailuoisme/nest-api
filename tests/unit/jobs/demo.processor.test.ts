/**
 * DemoProcessor 单元测试
 *
 * 覆盖：按 job.name 分发到对应分支，并输出正确的 Logger（log/warn）
 */
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DemoJobData, DemoJobName } from '@/jobs/demo/demo.jobs';
import { DemoProcessor } from '@/jobs/demo/demo.processor';

describe('DemoProcessor', () => {
  let processor: DemoProcessor;

  /** 创建 mock Job */
  function createMockJob(name: string, data: DemoJobData, timestamp = Date.now()): Job<DemoJobData> {
    return { name, data, id: '1', timestamp } as unknown as Job<DemoJobData>;
  }

  beforeEach(() => {
    processor = new DemoProcessor();
  });

  describe('process() — 按 job.name 分发', () => {
    it('Delayed job 应调用 logger.log 并打印实际等待时长', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const job = createMockJob(DemoJobName.Delayed, { message: 'delayed at boot' }, Date.now() - 30_000);

      await processor.process(job);

      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Delayed job executed: id=\d+, waited=\d+ms/));
    });

    it('Tick job 应调用 logger.log', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await processor.process(createMockJob(DemoJobName.Tick, { message: 'every-minute tick' }));

      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Scheduled job executed: id=\d+, time=/));
    });

    it('未知 job name 应调用 logger.warn', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await processor.process(createMockJob('unknown-job', { message: 'x' }));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown demo job'));
    });
  });
});

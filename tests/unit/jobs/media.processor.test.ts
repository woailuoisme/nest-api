import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GenerateVariantsJobData, MediaJobName } from '@/jobs/media/media.jobs';
import { MediaProcessor } from '@/jobs/media/media.processor';

describe('MediaProcessor', () => {
  let processor: MediaProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new MediaProcessor();
  });

  describe('process()', () => {
    it('消费 GenerateVariants 任务时记录弃用日志并安全返回（已被 imgproxy JIT 取代）', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      const job = {
        id: 'job-123',
        name: MediaJobName.GenerateVariants,
        data: {
          mainPath: 'photos/20260820/sample.png',
          variants: {
            thumb: { width: 100, height: 100, format: 'webp' },
            medium: { width: 250, format: 'png' },
          },
        },
      } as unknown as Job<GenerateVariantsJobData>;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[已弃用] 忽略历史物理切图任务'));
    });

    it('未知 job name 时记录警告且不抛出错误', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const job = {
        name: 'unknown-media-job',
        data: {},
      } as unknown as Job<any>;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith('Unknown media job name: unknown-media-job');
    });
  });
});

import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaJobName, MediaJobs } from '@/jobs/media/media.jobs';

describe('MediaJobs', () => {
  let mediaJobs: MediaJobs;
  let queueMock: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queueMock = {
      add: vi.fn().mockResolvedValue({ id: 'job-123', name: MediaJobName.GenerateVariants }),
      getJob: vi.fn(),
    };
    mediaJobs = new MediaJobs(queueMock as unknown as Queue);
  });

  describe('dispatchGenerateVariants()', () => {
    it('向 BullMQ 投递多规格生成任务并配置 3 次指数退避重试', async () => {
      const payload = {
        mainPath: 'avatars/20260820/abc.webp',
        variants: {
          thumb: { width: 150, height: 150 },
        },
        disk: 'local',
      };

      const job = await mediaJobs.dispatchGenerateVariants(payload);

      expect(queueMock.add).toHaveBeenCalledTimes(1);
      const [jobName, data, options] = queueMock.add.mock.calls[0];

      expect(jobName).toBe(MediaJobName.GenerateVariants);
      expect(data).toEqual(payload);
      expect(options).toMatchObject({
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      expect(job).toEqual({ id: 'job-123', name: MediaJobName.GenerateVariants });
    });
  });

  describe('removeJob()', () => {
    it('任务存在时调用 job.remove() 并返回 true', async () => {
      const jobMock = { remove: vi.fn().mockResolvedValue(undefined) };
      queueMock.getJob.mockResolvedValue(jobMock);

      const result = await mediaJobs.removeJob('job-123');
      expect(queueMock.getJob).toHaveBeenCalledWith('job-123');
      expect(jobMock.remove).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('任务不存在时返回 false', async () => {
      queueMock.getJob.mockResolvedValue(null);

      const result = await mediaJobs.removeJob('job-404');
      expect(result).toBe(false);
    });
  });
});

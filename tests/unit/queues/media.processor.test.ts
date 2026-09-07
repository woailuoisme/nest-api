import type { Job } from 'bullmq';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from '@/common/media/media.service';
import { type GenerateVariantsJobData, MediaJobName } from '@/queues/media/media.jobs';
import { MediaProcessor } from '@/queues/media/media.processor';

describe('MediaProcessor', () => {
  let processor: MediaProcessor;
  let mediaService: MediaService;
  let testImageBuffer: Buffer;

  const storageMock = {
    disk: vi.fn().mockReturnThis(),
    get: vi.fn(),
    put: vi.fn().mockResolvedValue('stored-path'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    testImageBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    storageMock.get.mockResolvedValue(testImageBuffer);
    mediaService = new MediaService(storageMock as any);
    processor = new MediaProcessor(storageMock as any, mediaService);
  });

  describe('process()', () => {
    it('成功消费 GenerateVariants 任务并生成多规格缩略图存盘', async () => {
      const job = {
        name: MediaJobName.GenerateVariants,
        data: {
          mainPath: 'photos/20260820/sample.png',
          variants: {
            thumb: { width: 100, height: 100, format: 'webp' },
            medium: { width: 250, format: 'png' },
          },
        },
      } as unknown as Job<GenerateVariantsJobData>;

      await processor.process(job);

      expect(storageMock.get).toHaveBeenCalledWith('photos/20260820/sample.png');
      expect(storageMock.put).toHaveBeenCalledTimes(2);

      const [call1, call2] = storageMock.put.mock.calls;
      expect(call1[0]).toBe('photos/20260820/sample_thumb.webp');
      expect(call1[2]).toEqual({ contentType: 'image/webp' });

      expect(call2[0]).toBe('photos/20260820/sample_medium.png');
      expect(call2[2]).toEqual({ contentType: 'image/png' });
    });

    it('主媒体文件不存在时抛出异常以便 BullMQ 触发重试', async () => {
      storageMock.get.mockResolvedValue(null);

      const job = {
        name: MediaJobName.GenerateVariants,
        data: {
          mainPath: 'photos/not-found.png',
          variants: {
            thumb: { width: 100, height: 100 },
          },
        },
      } as unknown as Job<GenerateVariantsJobData>;

      await expect(processor.process(job)).rejects.toThrow('主媒体文件不存在');
    });

    it('未知 job name 时记录警告且不抛出错误', async () => {
      const job = {
        name: 'unknown-media-job',
        data: {},
      } as unknown as Job<any>;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(storageMock.put).not.toHaveBeenCalled();
    });
  });
});

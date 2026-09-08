import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MEDIA_QUEUE } from '@/common/constants/queues';
import { MediaService } from '@/common/media/media.service';
import { buildVariantPath } from '@/common/media/strategies/naming.strategy';
import { StorageService } from '@/common/storage/storage.service';
import { type GenerateVariantsJobData, MediaJobName } from './media.jobs';

/**
 * 媒体队列消费者 — 消费 BullMQ 任务并在后台调用 MediaService 执行图像转码与多规格变体生成。
 */
@Processor(MEDIA_QUEUE, { concurrency: 5 })
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly mediaService: MediaService,
  ) {
    super();
  }

  async process(job: Job<GenerateVariantsJobData>): Promise<void> {
    switch (job.name) {
      case MediaJobName.GenerateVariants:
        await this.handleGenerateVariants(job.data);
        break;
      default:
        this.logger.warn(`Unknown media job name: ${job.name}`);
    }
  }

  /** 处理多规格缩略图衍生任务 */
  private async handleGenerateVariants(data: GenerateVariantsJobData): Promise<void> {
    const disk = this.storage.disk(data.disk);
    const mainBuffer = await disk.get(data.mainPath);
    if (!mainBuffer) {
      throw new Error(`主媒体文件不存在，无法生成变体: ${data.mainPath}`);
    }

    const variantEntries = Object.entries(data.variants);
    for (const [variantName, variantOpts] of variantEntries) {
      const { buffer: variantBuffer } = await this.mediaService.transformImage(mainBuffer, variantOpts);
      const variantFormat = variantOpts.format ?? 'webp';
      const variantPath = buildVariantPath(data.mainPath, variantName, variantFormat);
      const contentType = `image/${variantFormat}`;

      await disk.put(variantPath, variantBuffer, { contentType });
    }

    this.logger.log(
      `成功为 ${data.mainPath} 异步生成 ${variantEntries.length} 个缩略图变体: ${Object.keys(data.variants).join(', ')}`,
    );
  }
}

import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MEDIA_QUEUE } from '@/common/constants/queues';
import { QueueProcessorHost } from '@/jobs/queue-processor.host';

import { type GenerateVariantsJobData, MediaJobName } from './media.jobs';

/**
 * 媒体队列消费者 (MediaProcessor)
 *
 * 图像多规格缩略图已全面升级为 imgproxy JIT 动态实时渲染，不再向磁盘写入物理切图文件。
 * 本消费者仅作向后兼容保留，安全消费历史积压的旧任务。
 */
@Processor(MEDIA_QUEUE, { concurrency: 5 })
export class MediaProcessor extends QueueProcessorHost {
  private readonly logger = new Logger(MediaProcessor.name);

  async process(job: Job<GenerateVariantsJobData>): Promise<void> {
    switch (job.name) {
      case MediaJobName.GenerateVariants:
        this.logger.log(`[已弃用] 忽略历史物理切图任务: ${job.id} (${job.data.mainPath})，已全面由 imgproxy 动态接管`);
        break;
      default:
        this.logger.warn(`Unknown media job name: ${job.name}`);
    }
  }
}

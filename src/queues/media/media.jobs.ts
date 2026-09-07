import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MEDIA_QUEUE } from '@/common/constants/queues';
import type { ImageResizeOptions } from '@/common/media/interfaces/media.interface';

/** 媒体任务名称枚举 */
export enum MediaJobName {
  GenerateVariants = 'generate-variants',
}

/** 多规格缩略图衍生任务数据载荷 */
export interface GenerateVariantsJobData {
  /** 主图相对存储路径 (如 avatars/20260820/uuid.webp) */
  mainPath: string;
  /** 需衍生的多规格变体定义字典 */
  variants: Record<string, ImageResizeOptions>;
  /** 目标存储磁盘 (可选) */
  disk?: string;
}

/**
 * 媒体队列生产者 — 向 BullMQ 投递异步媒体处理任务。
 *
 * 仅传递存储相对路径而非整个文件二进制，避免占用 Redis 内存，实现零网络开销与高并发投递。
 */
@Injectable()
export class MediaJobs {
  constructor(@InjectQueue(MEDIA_QUEUE) private readonly queue: Queue) {}

  /**
   * 投递多规格变体/缩略图生成任务
   */
  async dispatchGenerateVariants(data: GenerateVariantsJobData): Promise<Job<GenerateVariantsJobData>> {
    return this.queue.add(MediaJobName.GenerateVariants, data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  /**
   * 从队列中取消或移除指定的未完成任务 (用于补偿回滚)
   */
  async removeJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

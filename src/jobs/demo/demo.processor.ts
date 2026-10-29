import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { DEMO_QUEUE } from '@/common/constants/queues';
import { QueueProcessorHost } from '@/jobs/queue-processor.host';

import { type DemoJobData, DemoJobName } from './demo.jobs';

/**
 * Demo 队列消费者 — 演示延迟 job 与定时 job 的执行日志输出。
 * 纯路由 + 日志，不依赖数据库，用于观测队列链路（生产者 → Redis → 消费者）。
 */
@Injectable()
@Processor(DEMO_QUEUE)
export class DemoProcessor extends QueueProcessorHost {
  private readonly logger = new Logger(DemoProcessor.name);

  async process(job: Job<DemoJobData>): Promise<void> {
    switch (job.name) {
      case DemoJobName.Delayed:
        this.logger.log(`Delayed job executed: id=${job.id}, waited=${Date.now() - job.timestamp}ms`);
        break;
      case DemoJobName.Tick:
        this.logger.log(`Scheduled job executed: id=${job.id}, time=${new Date().toISOString()}`);
        break;
      default:
        this.logger.warn(`Unknown demo job: ${job.name}`);
    }
  }
}

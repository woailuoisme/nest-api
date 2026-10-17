import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { DEMO_QUEUE } from '@/common/constants/queues';

/**
 * Demo 队列契约 — 类型 + 生产者（DemoJobs）二合一，生产/消费两侧共用。
 * 队列名常量统一见 src/common/constants/queues.ts。
 *
 * 用途：演示延迟 job（Delayed）与每分钟定时 job（Tick）的投递与消费链路，验证日志输出。
 *
 * 生产者（业务模块）— 注入并投递任务：
 *   @Inject() private readonly demoJobs: DemoJobs;
 *   await this.demoJobs.queueDelayed('hello', 30_000);
 *
 * 消费者（Worker 进程，WorkerModule）— 由 processor 路由：
 *   // demo.processor.ts: @Processor(DEMO_QUEUE) 按 job.name 分发
 */

/** Demo 任务名称 */
export enum DemoJobName {
  /** 延迟演示任务 */
  Delayed = 'delayed',
  /** 每分钟定时演示任务 */
  Tick = 'tick',
}

/** Demo 任务数据载荷 */
export interface DemoJobData {
  message: string;
}

/** Demo 队列生产者 — 向 BullMQ 投递演示任务 */
@Injectable()
export class DemoJobs {
  constructor(@InjectQueue(DEMO_QUEUE) private readonly queue: Queue) {}

  /** 投递延迟 job，delayMs 毫秒后由消费者执行 */
  queueDelayed(message: string, delayMs: number) {
    return this.queue.add(DemoJobName.Delayed, { message }, { delay: delayMs });
  }

  /** 投递定时 tick job */
  queueTick(message: string) {
    return this.queue.add(DemoJobName.Tick, { message });
  }
}

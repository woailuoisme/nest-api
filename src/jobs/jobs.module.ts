import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { ALL_QUEUE_NAMES } from '@/common/constants/queues';
import { QUEUE_DEFAULT_JOB_OPTIONS } from '@/database/bull.config';

import { DemoJobs } from './demo/demo.jobs';
import { MailJobs } from './mail/mail.jobs';
import { SearchJobs } from './search/search.jobs';

/**
 * 队列模块（生产者侧）— 注册队列供生产者注入投递任务。
 * 标记为 @Global，业务模块（如 AuthModule, SearchModule）无需重复 import 即可注入 MailJobs（邮件生产者）/ SearchJobs。
 * 消费者（processor）不在此注册，由 WorkerModule（独立进程）负责消费。
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      ...ALL_QUEUE_NAMES.map((name) => ({ name, defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS })),
    ),
  ],
  providers: [MailJobs, DemoJobs, SearchJobs],
  exports: [MailJobs, DemoJobs, SearchJobs],
})
export class JobsModule {}

/** 向后兼容别名 */
export { JobsModule as QueuesModule };

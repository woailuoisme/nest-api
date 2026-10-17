import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DEMO_QUEUE, TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';

import { DemoSchedule } from './demo.schedule';
import { TokenCleanupSchedule } from './token-cleanup.schedule';

/**
 * 调度声明模块 — 聚合所有定时调度（对齐 Laravel routes/console.php）。
 * 只注册有调度需求的队列；由 WorkerModule 导入，生产侧 QueuesModule 不感知。
 * 新增定时任务：新建 src/schedules/xxx.schedule.ts 并在此 providers 挂载即可。
 */
@Module({
  imports: [BullModule.registerQueue({ name: TOKEN_CLEANUP_QUEUE }, { name: DEMO_QUEUE })],
  providers: [TokenCleanupSchedule, DemoSchedule],
})
export class SchedulesModule {}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { APP_ENV_VALUES } from '@/common/constants/app.constants';
import { DEMO_QUEUE } from '@/common/constants/queues';
import type { EnvConfig } from '@/config/env.validation';
import { DemoJobName } from '@/jobs/demo/demo.jobs';

/**
 * Demo 队列调度声明 — 应用启动时注册每分钟定时任务，并投递一个延迟 30 秒的演示 job。
 * 集中注册于 SchedulesModule，仅在 Worker 进程生效，API/CLI 进程不注册，避免重复调度。
 */
@Injectable()
export class DemoSchedule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSchedule.name);

  constructor(
    @InjectQueue(DEMO_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const appEnv = this.config.get('APP_ENV');
    // 仅在非测试环境注册定时任务与延迟演示（避免单测/CI 触发真实 Redis 调度）
    if (appEnv === APP_ENV_VALUES.TESTING) {
      this.logger.log(`Demo schedule disabled (APP_ENV=${appEnv})`);
      return;
    }

    // upsertJobScheduler 确保幂等：多次重启不会创建重复的每分钟定时任务
    await this.queue.upsertJobScheduler(
      'every-minute-demo-tick',
      { pattern: '* * * * *' }, // 每 1 分钟
      {
        name: DemoJobName.Tick,
        data: { message: 'every-minute tick' },
        opts: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      },
    );

    // 启动时投递一个延迟 30 秒的演示 job，便于直接观测延迟执行日志
    await this.queue.add(DemoJobName.Delayed, { message: 'delayed at boot' }, { delay: 30_000 });

    this.logger.debug('Demo schedule registered (tick every minute, delayed job in 30s)');
  }
}

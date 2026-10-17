import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { APP_ENV_VALUES } from '@/common/constants/app.constants';
import { TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import type { EnvConfig } from '@/config/env.validation';
import { TokenCleanupJobName } from '@/jobs/token-cleanup/token-cleanup.jobs';

/**
 * Token 清理调度声明 — 应用启动时注册每日定时清理任务。
 * 集中注册于 SchedulesModule，仅在 Worker 进程生效，API/CLI 进程不注册，避免重复调度。
 */
@Injectable()
export class TokenCleanupSchedule implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenCleanupSchedule.name);

  constructor(
    @InjectQueue(TOKEN_CLEANUP_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const appEnv = this.config.get('APP_ENV');
    // 仅在非测试环境注册定时任务（测试环境不需要定时清理）
    if (appEnv === APP_ENV_VALUES.TESTING) {
      this.logger.log(`Token cleanup schedule disabled (APP_ENV=${appEnv})`);
      return;
    }

    // upsertJobScheduler 确保幂等：多次重启不会创建重复的定时任务
    await this.queue.upsertJobScheduler(
      'daily-token-cleanup',
      { pattern: '0 3 * * *' }, // 每天凌晨 3 点
      {
        name: TokenCleanupJobName.PurgeExpired,
        data: { batchSize: 1000 },
        opts: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      },
    );

    this.logger.debug('Token cleanup schedule registered (daily at 03:00)');
  }
}

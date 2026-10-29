import type { BullRootModuleOptions } from '@nestjs/bullmq';
import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';

import type { EnvConfig } from '@/config/env.validation';

/** BullMQ 队列模块配置 (依赖 Redis 环境变量) */
export function createBullModuleConfig(config: ConfigService<EnvConfig, true>): BullRootModuleOptions {
  return {
    connection: {
      url: config.get('REDIS_URL'),
    },
  };
}

/**
 * 队列默认 job 保留策略。
 *
 * BullMQ 默认永久保留已完成/失败的 job，长期运行会让 Redis 内存无界增长
 * （`bull:<queue>:<id>` 哈希 + completed/failed zset），最终触发 `OOM command not allowed`。
 * 这里按时间与条数双维度收敛：完成任务留 1 小时、失败任务留 24 小时，超出即删除。
 */
export const QUEUE_DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 5_000 },
};

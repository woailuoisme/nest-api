import type { BullRootModuleOptions } from '@nestjs/bullmq';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.validation';

/** BullMQ 队列模块配置 (依赖 Redis 环境变量) */
export function createBullModuleConfig(config: ConfigService<EnvConfig, true>): BullRootModuleOptions {
  return {
    connection: {
      url: config.get('REDIS_URL'),
    },
  };
}

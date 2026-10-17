import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';

import { INJECTION_TOKENS } from '@/common/constants/app.constants';
import type { EnvConfig } from '@/config/env.validation';
import { REDIS_CLIENT, RedisModule } from '@/database/redis.module';

import { RedisThrottlerStorage } from './redis-throttler-storage';

/** 限流存储注入令牌：由本模块提供，供 ThrottlerModule 装配消费 */
export const THROTTLER_STORAGE = INJECTION_TOKENS.THROTTLER_STORAGE;

/**
 * 按驱动创建限流存储
 *
 * - `redis`（默认）：跨副本共享计数，Redis 故障时由存储自身降级为进程内计数；
 * - `memory`：仅进程内计数（本地无 Redis 场景），直接复用容器托管的 `ThrottlerStorageService`
 *   （其 sweep 定时器随应用关闭清理）。
 */
export function createThrottlerStorage(
  driver: EnvConfig['THROTTLE_STORAGE'],
  memoryStorage: ThrottlerStorageService,
  redisClient: Redis,
): ThrottlerStorage {
  return driver === 'memory' ? memoryStorage : new RedisThrottlerStorage(redisClient, memoryStorage);
}

/**
 * 限流存储模块
 *
 * `ThrottlerStorageService` 始终注册：既可作为 memory 驱动的存储本体，也作为 redis 驱动的降级兜底。
 */
@Module({
  imports: [RedisModule],
  providers: [
    ThrottlerStorageService,
    {
      provide: THROTTLER_STORAGE,
      inject: [ConfigService, ThrottlerStorageService, REDIS_CLIENT],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        memoryStorage: ThrottlerStorageService,
        redisClient: Redis,
      ): ThrottlerStorage => createThrottlerStorage(config.get('THROTTLE_STORAGE'), memoryStorage, redisClient),
    },
  ],
  exports: [THROTTLER_STORAGE],
})
export class ThrottlerStorageModule {}

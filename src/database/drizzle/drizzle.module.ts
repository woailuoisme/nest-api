import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';

import type { EnvConfig } from '@/config/env.validation';

import { createDatabase } from './database';
import { createPgPool } from './pg';

/**
 * 数据库装配的唯一注册点：官方 `DrizzleModule.forRootAsync` + 自建连接池。
 * App / Cli / Worker 三个入口统一引用本模块，连接参数只写一份。
 */
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        db: createDatabase(
          createPgPool(config.get('DB_URL'), {
            max: config.get('DB_POOL_MAX'),
            idleTimeoutMillis: config.get('DB_POOL_IDLE_TIMEOUT_MS'),
            connectionTimeoutMillis: config.get('DB_POOL_CONNECT_TIMEOUT_MS'),
          }),
        ),
      }),
    }),
  ],
})
export class DatabaseModule {}

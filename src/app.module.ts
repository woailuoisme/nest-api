import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { I18nModule } from 'nestjs-i18n';
import { API_MODULES } from '@/api';
import { AccessControlGuard } from '@/common/guards/access-control.guard';
import { AdminPrefixGuard } from '@/common/guards/admin-prefix.guard';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';
import { CommandsModule } from './commands/commands.module';
import { ExcelModule } from './common/excel/excel.module';
import { IdempotencyModule } from './common/idempotency';
import { MediaModule } from './common/media/media.module';
import { StorageModule } from './common/storage/storage.module';
import { type EnvConfig, validateEnv } from './config/env.validation';
import { createBullModuleConfig } from './database/bull.config';
import { DatabaseModule } from './database/drizzle/drizzle.module';
import { RedisModule } from './database/redis.module';
import { createI18nModuleConfig } from './i18n/i18n.config';
import { QueuesModule } from './queues/queues.module';
import { RealtimeModule } from './realtime/realtime.module';
import { LoggerModule } from './setup/logger/logger.module';
import { WorkerModule } from './workers/worker.module';

const isWorkerEmbedded = ['true', '1', 'yes', 'on'].includes(String(process.env.WORKER_EMBEDDED).toLowerCase());

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    I18nModule.forRoot(createI18nModuleConfig()),
    LoggerModule,
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => [
        {
          ttl: config.get('THROTTLE_TTL') * 1000,
          limit: config.get('THROTTLE_LIMIT'),
        },
      ],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    DatabaseModule,
    RedisModule,
    StorageModule,
    MediaModule,
    ExcelModule,
    IdempotencyModule,
    ...API_MODULES,
    RealtimeModule,
    QueuesModule,
    CommandsModule,
    ...(isWorkerEmbedded ? [WorkerModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: AdminPrefixGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
  ],
})
export class AppModule {}

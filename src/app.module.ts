import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { I18nModule } from 'nestjs-i18n';
import { isTruthyEnv } from '@/common/constants/app.constants';
import { AccessControlGuard } from '@/common/guards/access-control.guard';
import { AdminPrefixGuard } from '@/common/guards/admin-prefix.guard';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';
import { FEATURE_MODULES } from '@/features';
import { CommandsModule } from './commands/commands.module';
import { CacheModule } from './common/cache';
import { ExcelModule } from './common/excel/excel.module';
import { IdempotencyModule } from './common/idempotency';
import { MailModule } from './common/mail';
import { MediaModule } from './common/media/media.module';
import { LoadSheddingGuard, ResilienceModule } from './common/resilience';
import { SearchModule } from './common/search/search.module';
import { StorageModule } from './common/storage/storage.module';
import { type EnvConfig, validateEnv } from './config/env.validation';
import { createBullModuleConfig } from './database/bull.config';
import { DatabaseModule } from './database/drizzle/drizzle.module';
import { RedisModule } from './database/redis.module';
import { createI18nModuleConfig } from './i18n/i18n.config';
import { IotModule } from './iot/iot.module';
import { JobsModule } from './jobs/jobs.module';
import { RealtimeModule } from './realtime/realtime.module';
import { LoggerModule } from './setup/logger/logger.module';
import { WorkerModule } from './workers/worker.module';

// 模块装饰器求值阶段 ConfigService 尚不可用，直接读取 process.env 判定内嵌 Worker
const isWorkerEmbedded = isTruthyEnv(process.env.WORKER_EMBEDDED);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot({ wildcard: true }),
    I18nModule.forRoot(createI18nModuleConfig()),
    LoggerModule,
    ThrottlerModule.forRootAsync({
      // ThrottlerAsyncOptions 要求显式声明 imports（即使为空）
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
    CacheModule,
    StorageModule,
    MailModule,
    MediaModule,
    SearchModule,
    ExcelModule,
    IotModule,
    IdempotencyModule,
    ResilienceModule,
    ...FEATURE_MODULES,
    RealtimeModule,
    JobsModule,
    CommandsModule,
    ...(isWorkerEmbedded ? [WorkerModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: LoadSheddingGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: AdminPrefixGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
  ],
})
export class AppModule {}

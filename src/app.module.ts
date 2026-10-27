import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { I18nModule } from 'nestjs-i18n';

import { CasbinService } from '@/common/auth/casbin/casbin.service';
import { AccessControlGuard } from '@/common/guards/access-control.guard';
import { AdminPrefixGuard } from '@/common/guards/admin-prefix.guard';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';
import { FEATURE_MODULES } from '@/features';

import { CommandsModule } from './commands/commands.module';
import { CacheModule } from './common/cache';
import { HttpModule } from './common/http';
import { IdempotencyModule } from './common/idempotency';
import { MailModule } from './common/mail';
import { MediaModule } from './common/media/media.module';
import { ResilienceModule } from './common/resilience';
import { SearchModule } from './common/search/search.module';
import { StorageModule } from './common/storage/storage.module';
import { THROTTLER_STORAGE, ThrottlerStorageModule } from './common/throttler';
import { MiniprogramModule } from './common/wechat/miniprogram';
import { WepayModule } from './common/wechat/pay';
import { type EnvConfig, envSchema } from './config/env.validation';
import { createBullModuleConfig } from './database/bull.config';
import { DatabaseModule } from './database/drizzle/drizzle.module';
import { RedisModule } from './database/redis.module';
import { createI18nModuleConfig } from './i18n/i18n.config';
import { IotModule } from './iot/iot.module';
import { JobsModule } from './jobs/jobs.module';
import { RealtimeModule } from './realtime/realtime.module';
import { LoggerModule } from './setup/logger/logger.module';

@Module({
  imports: [
    // 采用 Nest 12 原生 Standard Schema 通道校验环境变量（Zod schema 即契约，校验失败格式与旧 validate 一致）
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    EventEmitterModule.forRoot({ wildcard: true }),
    IdempotencyModule,
    I18nModule.forRoot(createI18nModuleConfig()),
    LoggerModule,
    ThrottlerModule.forRootAsync({
      // 必须以「对象形态」提供选项：@nestjs/throttler 仅在非数组形态下才采用 options.storage，
      // 数组形态会强制回落到进程内 ThrottlerStorageService —— 多副本部署下限流额度将被放大 N 倍
      imports: [ThrottlerStorageModule],
      inject: [ConfigService, THROTTLER_STORAGE],
      useFactory: (config: ConfigService<EnvConfig, true>, storage: ThrottlerStorage) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL') * 1000,
            limit: config.get('THROTTLE_LIMIT'),
          },
        ],
        storage,
      }),
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
    WepayModule,
    MiniprogramModule,
    SearchModule,
    IotModule,
    HttpModule,
    ResilienceModule,
    ...FEATURE_MODULES,
    RealtimeModule,
    JobsModule,
    CommandsModule,
  ],
  providers: [
    // 权限判定引擎（策略由 ROLE_PERMISSIONS 生成，守卫按需注入）
    CasbinService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: AdminPrefixGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
  ],
})
export class AppModule {}

import { AuthenticationGuard, AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationGuard, AuthorizationModule } from '@nestjs/authorization';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { I18nModule } from '@nestjs/i18n';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';

import { createAuthenticationModuleOptions } from '@/common/auth/authentication.options';
import { AdminPolicy } from '@/common/authorization/policies/admin.policy';
import { IotPolicy } from '@/common/authorization/policies/iot.policy';
import { UserPolicy } from '@/common/authorization/policies/user.policy';
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

/**
 * 限流模块配置。
 *
 * 必须以「对象形态」提供选项：@nestjs/throttler 仅在非数组形态下才采用 options.storage，
 * 数组形态会强制回落到进程内 ThrottlerStorageService —— 多副本部署下限流额度将被放大 N 倍。
 */
function createThrottlerConfig(config: ConfigService<EnvConfig, true>, storage: ThrottlerStorage) {
  return {
    throttlers: [{ ttl: config.get('THROTTLE_TTL') * 1000, limit: config.get('THROTTLE_LIMIT') }],
    storage,
  };
}

@Module({
  imports: [
    // 采用 Nest 12 原生 Standard Schema 通道校验环境变量（Zod schema 即契约，校验失败格式与旧 validate 一致）
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    EventEmitterModule.forRoot({ wildcard: true }),
    IdempotencyModule,
    I18nModule.forRoot(createI18nModuleConfig()),
    LoggerModule,
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [ConfigService, THROTTLER_STORAGE],
      useFactory: createThrottlerConfig,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    AuthenticationModule.forRootAsync({
      globalGuard: false,
      inject: [ConfigService],
      useFactory: createAuthenticationModuleOptions,
    }),
    AuthorizationModule.forRoot({
      globalGuard: false,
      policies: [AdminPolicy, UserPolicy, IotPolicy],
    }),
    DatabaseModule,
    RedisModule,
    CacheModule,
    StorageModule,
    MailModule.forRoot(),
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class AppModule {}

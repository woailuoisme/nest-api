import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { FEATURE_MODULES } from '@/features';

import { CommandsModule } from './commands/commands.module';
import { MediaModule } from './common/media/media.module';
import { ResilienceModule } from './common/resilience';
import { SearchModule } from './common/search/search.module';
import { StorageModule } from './common/storage/storage.module';
import { MiniprogramModule } from './common/wechat/miniprogram';
import { WepayModule } from './common/wechat/pay';
import { envSchema } from './config/env.validation';
import { createBullModuleConfig } from './database/bull.config';
import { DatabaseModule } from './database/drizzle/drizzle.module';
import { RedisModule } from './database/redis.module';
import { IotModule } from './iot/iot.module';
import { JobsModule } from './jobs/jobs.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    EventEmitterModule.forRoot({ wildcard: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    DatabaseModule,
    RedisModule,
    StorageModule,
    MediaModule,
    WepayModule,
    MiniprogramModule,
    SearchModule,
    IotModule,
    ResilienceModule,
    ...FEATURE_MODULES,
    RealtimeModule,
    JobsModule,
    CommandsModule,
  ],
})
export class CliModule {}

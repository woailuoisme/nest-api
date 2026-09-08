import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FEATURE_MODULES } from '@/features';
import { CommandsModule } from './commands/commands.module';
import { MediaModule } from './common/media/media.module';
import { StorageModule } from './common/storage/storage.module';
import { validateEnv } from './config/env.validation';
import { createBullModuleConfig } from './database/bull.config';
import { DatabaseModule } from './database/drizzle/drizzle.module';
import { RedisModule } from './database/redis.module';
import { JobsModule } from './jobs/jobs.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    DatabaseModule,
    RedisModule,
    StorageModule,
    MediaModule,
    ...FEATURE_MODULES,
    RealtimeModule,
    JobsModule,
    CommandsModule,
  ],
})
export class CliModule {}

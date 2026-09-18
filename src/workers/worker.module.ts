import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ALL_QUEUE_NAMES } from '@/common/constants/queues';
import { MailModule } from '@/common/mail';
import { MediaModule } from '@/common/media/media.module';
import { SearchModule } from '@/common/search/search.module';
import { StorageModule } from '@/common/storage/storage.module';
import { validateEnv } from '@/config/env.validation';
import { createBullModuleConfig } from '@/database/bull.config';
import { DatabaseModule } from '@/database/drizzle/drizzle.module';
import { DemoProcessor } from '@/jobs/demo/demo.processor';
import { MailProcessor } from '@/jobs/mail/mail.processor';
import { MediaProcessor } from '@/jobs/media/media.processor';
import { SearchProcessor } from '@/jobs/search/search.processor';
import { TokenCleanupProcessor } from '@/jobs/token-cleanup/token-cleanup.processor';
import { SchedulesModule } from '@/schedules/schedules.module';
import { LoggerModule } from '@/setup/logger/logger.module';

/**
 * Worker 模块 — 独立进程（worker.main.ts）专用，只消费队列、不提供 HTTP。
 * 聚合注册所有队列消费者，定时调度由 SchedulesModule 统一声明，与 AppModule（HTTP）进程分离部署。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    BullModule.registerQueue(...ALL_QUEUE_NAMES.map((name) => ({ name }))),
    DatabaseModule,
    StorageModule,
    MailModule,
    MediaModule,
    SearchModule,
    SchedulesModule,
  ],
  providers: [MailProcessor, TokenCleanupProcessor, DemoProcessor, MediaProcessor, SearchProcessor],
})
export class WorkerModule {}

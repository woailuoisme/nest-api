import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthTokenManager } from '@/api/client/auth/auth-token.manager';
import { DEMO_QUEUE, MAIL_QUEUE, MEDIA_QUEUE, TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import { MediaModule } from '@/common/media/media.module';
import { StorageModule } from '@/common/storage/storage.module';
import { validateEnv } from '@/config/env.validation';
import { createBullModuleConfig } from '@/database/bull.config';
import { DatabaseModule } from '@/database/drizzle/drizzle.module';
import { DemoProcessor } from '@/queues/demo/demo.processor';
import { MailHandlers } from '@/queues/mail/mail.handlers';
import { MailProcessor } from '@/queues/mail/mail.processor';
import { MailTemplateService } from '@/queues/mail/mail.template.service';
import { MediaProcessor } from '@/queues/media/media.processor';
import { TokenCleanupProcessor } from '@/queues/token-cleanup/token-cleanup.processor';
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
    JwtModule.register({}),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullModuleConfig,
    }),
    BullModule.registerQueue(
      { name: MAIL_QUEUE },
      { name: TOKEN_CLEANUP_QUEUE },
      { name: DEMO_QUEUE },
      { name: MEDIA_QUEUE },
    ),
    DatabaseModule,
    StorageModule,
    MediaModule,
    SchedulesModule,
  ],
  providers: [
    AuthTokenManager,
    MailTemplateService,
    MailHandlers,
    MailProcessor,
    TokenCleanupProcessor,
    DemoProcessor,
    MediaProcessor,
  ],
})
export class WorkerModule {}

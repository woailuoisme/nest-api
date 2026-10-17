import 'dotenv/config';
import '@/setup/sentry';
import '@/setup/otel/telemetry';
import { NestFactory } from '@nestjs/core';

import { setupWorkerShutdownHooks } from '@/setup';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';

import { setupTimezone } from '../config/timezone';
import { WorkerModule } from './worker.module';

/**
 * Worker 进程引导 — 创建纯应用上下文（无 HTTP），
 * 消费 BullMQ 队列并注册每日定时清理任务，与 main.ts（HTTP）分离部署。
 */
async function bootstrap(): Promise<void> {
  setupTimezone();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLoggerService));

  // 统一优雅关机钩子（支持 SHUTDOWN_TIMEOUT_MS 超时保底与 BullMQ 消费等待）
  setupWorkerShutdownHooks(app);
}

bootstrap();

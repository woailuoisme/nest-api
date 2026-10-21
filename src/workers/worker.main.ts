import 'dotenv/config';
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

bootstrap().catch((error: unknown) => {
  // Worker 引导失败同样必须非零退出，避免队列长期无人消费而告警沉默
  process.stderr.write(
    `[Bootstrap] Worker 启动失败: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});

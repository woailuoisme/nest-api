import { NestFactory } from '@nestjs/core';

import { setupTimezone } from '@/config/timezone';
import { setupWorkerShutdownHooks } from '@/setup';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';

import { WorkerModule } from '../workers/worker.module';

/**
 * Worker 引导体 — `workers/worker.main.ts` 与 CLI `worker` 共用。
 *
 * 创建纯应用上下文（无 HTTP），消费 BullMQ 队列并运行定时任务；
 * 失败同样必须非零退出，避免队列长期无人消费而告警沉默。
 */
export async function startWorker(): Promise<void> {
  try {
    setupTimezone();
    const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
    app.useLogger(app.get(PinoLoggerService));

    // 统一优雅关机钩子（支持 SHUTDOWN_TIMEOUT_MS 超时保底与 BullMQ 消费等待）
    setupWorkerShutdownHooks(app);
  } catch (error: unknown) {
    process.stderr.write(
      `[Bootstrap] Worker 启动失败: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  }
}

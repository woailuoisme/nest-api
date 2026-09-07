import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
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

  // 优雅关机：SIGTERM/SIGINT 触发 app.close()，
  // @nestjs/bullmq 的 BullExplorer.onApplicationShutdown 会等待当前 job 完成后关闭 worker。
  const shutdown = async (signal: string): Promise<void> => {
    // 10s 强制超时保底，防止由于第三方挂起连接导致进程死锁
    const timer = setTimeout(() => {
      process.stderr.write(`[Worker Shutdown] Graceful shutdown timed out (10000ms, ${signal}), forcing exit.\n`);
      process.exit(1);
    }, 10_000);
    timer.unref();

    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();

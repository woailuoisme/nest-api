import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * 配置应用进程生命周期（支持优雅关机与 Docker 10s 超时兜底）
 */
export function setupShutdownHooks(app: NestFastifyApplication): void {
  // 开启 NestJS 优雅关机钩子（支持 Docker SIGTERM / SIGINT 信号）
  app.enableShutdownHooks();

  // 10s 强制超时保底，防止由于第三方挂起连接导致进程死锁（容器无法终止）
  const setupShutdownTimeout = (signal: string) => {
    const timer = setTimeout(() => {
      process.stderr.write(`[App] Graceful shutdown timed out (10000ms, ${signal}), forcing exit.\n`);
      process.exit(1);
    }, 10_000);
    timer.unref();
  };

  process.once('SIGTERM', () => setupShutdownTimeout('SIGTERM'));
  process.once('SIGINT', () => setupShutdownTimeout('SIGINT'));
}

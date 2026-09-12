import type { Server } from 'node:http';
import { type INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { delay } from 'es-toolkit';

/** 全局停机状态标记（用于向就绪探针与长连接协商传递下线状态） */
let isShuttingDown = false;

/**
 * 获取当前应用是否处于优雅停机阶段
 */
export function isAppShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * 显式更新优雅停机状态（主要供单测或自定义触发使用）
 */
export function setAppShuttingDown(value: boolean): void {
  isShuttingDown = value;
}

/**
 * 配置主应用进程优雅停机生命周期（Node 24 + Fastify 5 原生三阶段编排与超时保底）
 *
 * 阶段一：流量下线缓冲 (Deregistration Delay)
 * - 标记 isShuttingDown = true，使 /health/readiness 就绪探针立即报 503
 * - 等待 SHUTDOWN_DRAIN_DELAY_MS（供 Ingress / K8s iptables 摘除本 Pod 流量）
 *
 * 阶段二：HTTP 连接排干 (Connection Draining)
 * - 调用 Node 24 原生 server.closeIdleConnections() 释放所有 Keep-Alive 空闲 Socket
 * - Fastify onSend 钩子对在途响应自动附加 Connection: close 通知客户端断连
 *
 * 阶段三：基础设施释放与应用关闭 (Resource Cleanup)
 * - 执行 await app.close()，级联触发 Drizzle、Redis、MQTT、BullMQ 等模块的 onApplicationShutdown
 * - 全局 Watchdog (SHUTDOWN_TIMEOUT_MS) 强行超时保底，防止卡死
 */
export function setupShutdownHooks(app: NestFastifyApplication): void {
  const logger = new Logger('Lifecycle');
  let shutdownTimeoutMs = 10_000;
  let drainDelayMs = 0;

  try {
    const config = app.get(ConfigService, { strict: false });
    shutdownTimeoutMs = config?.get<number>('SHUTDOWN_TIMEOUT_MS') ?? 10_000;
    drainDelayMs = config?.get<number>('SHUTDOWN_DRAIN_DELAY_MS') ?? 0;
  } catch {
    // 降级保持默认阈值
  }

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // 0. 启动硬超时保底定时器（Watchdog）
    const watchdog = setTimeout(() => {
      process.stderr.write(
        `[Lifecycle] Graceful shutdown timed out (${shutdownTimeoutMs}ms, ${signal}), forcing exit.\n`,
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    watchdog.unref();

    logger.log(`收到 ${signal} 停机信号，开始执行三阶段优雅停机...`);

    // 阶段一：流量下线缓冲（Readiness 探针置灰）
    if (drainDelayMs > 0) {
      logger.log(`[阶段一/三] 就绪探针已注销，等待流量下线解绑缓冲 ${drainDelayMs}ms...`);
      await delay(drainDelayMs);
    }

    // 阶段二：HTTP 连接排干
    logger.log('[阶段二/三] 正在排干 HTTP 闲置连接并关闭网络监听...');
    try {
      const server = app.getHttpServer() as Server | undefined;
      if (server && typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    } catch (err) {
      logger.warn(`关闭闲置连接时发生异常: ${(err as Error).message}`);
    }

    // 阶段三：注销应用与底层依赖
    logger.log('[阶段三/三] 正在关闭应用并释放数据库、缓存与消息队列等底层基础设施...');
    try {
      await app.close();
      clearTimeout(watchdog);
      logger.log('应用已安全关闭，进程正常退出。');
      process.exit(0);
    } catch (err) {
      clearTimeout(watchdog);
      logger.error(`应用关闭过程中发生异常: ${(err as Error).message}`, (err as Error).stack);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.once('SIGINT', () => void handleShutdown('SIGINT'));
}

/**
 * 配置独立 Worker 进程的优雅停机生命周期（纯上下文无 HTTP 监听，等待 BullMQ 当前 Job 完成）
 */
export function setupWorkerShutdownHooks(app: INestApplicationContext): void {
  const logger = new Logger('WorkerLifecycle');
  let shutdownTimeoutMs = 10_000;

  try {
    const config = app.get(ConfigService, { strict: false });
    shutdownTimeoutMs = config?.get<number>('SHUTDOWN_TIMEOUT_MS') ?? 10_000;
  } catch {
    // 降级保持默认阈值
  }

  let isWorkerShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isWorkerShuttingDown) return;
    isWorkerShuttingDown = true;

    const watchdog = setTimeout(() => {
      process.stderr.write(
        `[WorkerLifecycle] Graceful shutdown timed out (${shutdownTimeoutMs}ms, ${signal}), forcing exit.\n`,
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    watchdog.unref();

    logger.log(`收到 ${signal} 停机信号，正在停止 Worker 并等待正在消费的队列任务安全完成...`);
    try {
      await app.close();
      clearTimeout(watchdog);
      logger.log('Worker 资源已全部安全释放，正常退出。');
      process.exit(0);
    } catch (err) {
      clearTimeout(watchdog);
      logger.error(`Worker 关闭过程中发生异常: ${(err as Error).message}`, (err as Error).stack);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.once('SIGINT', () => void handleShutdown('SIGINT'));
}

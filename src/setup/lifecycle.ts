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

/** 停机硬超时默认值（毫秒） */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Watchdog 标签（保持 stderr 输出与历史文案逐字一致） */
const HTTP_SHUTDOWN_TAG = 'Lifecycle';
const WORKER_SHUTDOWN_TAG = 'WorkerLifecycle';

/** 读取停机阈值：ConfigService 尚未就绪时整体降级为默认值，避免引导早期中断 */
function resolveShutdownTimings(app: INestApplicationContext): { timeoutMs: number; drainDelayMs: number } {
  try {
    const config = app.get(ConfigService, { strict: false });
    return {
      timeoutMs: config?.get<number>('SHUTDOWN_TIMEOUT_MS') ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      drainDelayMs: config?.get<number>('SHUTDOWN_DRAIN_DELAY_MS') ?? 0,
    };
  } catch {
    return { timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS, drainDelayMs: 0 };
  }
}

/** 启动硬超时 Watchdog：超时未完成即强制退出；返回取消函数（unref 不阻塞进程自然退出） */
function startShutdownWatchdog(tag: string, timeoutMs: number, signal: string): () => void {
  const watchdog = setTimeout(() => {
    process.stderr.write(`[${tag}] Graceful shutdown timed out (${timeoutMs}ms, ${signal}), forcing exit.\n`);
    process.exit(1);
  }, timeoutMs);
  watchdog.unref();
  return () => clearTimeout(watchdog);
}

/** 注册 SIGTERM / SIGINT → 优雅停机处理器（once 语义，避免重复触发） */
function registerShutdownSignals(handle: (signal: string) => Promise<void>): void {
  process.once('SIGTERM', () => void handle('SIGTERM'));
  process.once('SIGINT', () => void handle('SIGINT'));
}

/**
 * 配置主应用进程优雅停机生命周期（Node 24 + Fastify 5 原生三阶段编排与超时保底）
 *
 * 阶段一：流量下线缓冲 (Deregistration Delay)
 * - 标记 isShuttingDown = true，使 /readyz 就绪探针立即报 503
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
  const logger = new Logger(HTTP_SHUTDOWN_TAG);
  const { timeoutMs: shutdownTimeoutMs, drainDelayMs } = resolveShutdownTimings(app);

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // 0. 启动硬超时保底定时器（Watchdog）
    const cancelWatchdog = startShutdownWatchdog(HTTP_SHUTDOWN_TAG, shutdownTimeoutMs, signal);

    logger.log(`收到 ${signal} 停机信号，开始执行三阶段优雅停机...`);

    // 阶段一：流量下线缓冲（Readiness 探针注销）
    logger.log(
      drainDelayMs > 0
        ? `[1/3] 就绪探针已注销，等待流量下线解绑缓冲 ${drainDelayMs}ms...`
        : '[1/3] 就绪探针已注销并停止接收新流量...',
    );
    if (drainDelayMs > 0) {
      await delay(drainDelayMs);
    }

    // 阶段二：HTTP 连接排干
    logger.log('[2/3] 正在排干 HTTP 闲置连接并关闭网络监听...');
    try {
      const server = app.getHttpServer() as Server | undefined;
      if (server && typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    } catch (err) {
      logger.warn(`关闭闲置连接时发生异常: ${(err as Error).message}`);
    }

    // 阶段三：注销应用与底层依赖
    logger.log('[3/3] 正在关闭应用并释放数据库、缓存与消息队列等底层基础设施...');
    try {
      await app.close();
      // 停机期动态导入：flush OTel spans/metrics（未初始化时空操作），避免传递性求值污染非 OTel 入口
      const { shutdownTelemetry } = await import('./otel/telemetry');
      await shutdownTelemetry();
      cancelWatchdog();
      logger.log('应用已安全关闭，进程正常退出。');
      process.exit(0);
    } catch (err) {
      cancelWatchdog();
      logger.error(`应用关闭过程中发生异常: ${(err as Error).message}`, (err as Error).stack);
      process.exit(1);
    }
  };

  registerShutdownSignals(handleShutdown);
}

/**
 * 配置独立 Worker 进程的优雅停机生命周期（纯上下文无 HTTP 监听，等待 BullMQ 当前 Job 完成）
 */
export function setupWorkerShutdownHooks(app: INestApplicationContext): void {
  const logger = new Logger(WORKER_SHUTDOWN_TAG);
  const { timeoutMs: shutdownTimeoutMs } = resolveShutdownTimings(app);

  let isWorkerShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isWorkerShuttingDown) return;
    isWorkerShuttingDown = true;

    const cancelWatchdog = startShutdownWatchdog(WORKER_SHUTDOWN_TAG, shutdownTimeoutMs, signal);

    logger.log(`收到 ${signal} 停机信号，正在停止 Worker 并等待正在消费的队列任务安全完成...`);
    try {
      await app.close();
      // 同上：停机期动态导入 flush OTel
      const { shutdownTelemetry } = await import('./otel/telemetry');
      await shutdownTelemetry();
      cancelWatchdog();
      logger.log('Worker 资源已全部安全释放，正常退出。');
      process.exit(0);
    } catch (err) {
      cancelWatchdog();
      logger.error(`Worker 关闭过程中发生异常: ${(err as Error).message}`, (err as Error).stack);
      process.exit(1);
    }
  };

  registerShutdownSignals(handleShutdown);
}

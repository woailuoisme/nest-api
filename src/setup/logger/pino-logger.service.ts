import { Inject, Injectable, type LoggerService, type LogLevel, Optional } from '@nestjs/common';
import type { Logger as PinoInstance } from 'pino';

export const PINO_LOGGER = Symbol('PINO_LOGGER');

/** 启动阶段静默过滤的框架内部上下文集合（屏蔽日常加载与映射日志，保留 warn/error） */
export const SILENT_BOOTSTRAP_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestApplication',
  'NestFactory',
]);

/** HTTP 访问日志负载结构 */
export interface HttpAccessLogPayload {
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  ip: string;
}

/**
 * 原生 Pino 日志服务 — 实现 NestJS 官方 LoggerService 接口。
 * 包装全局 Pino 实例，支持上下文 Context、敏感信息脱敏与结构化日志输出。
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(@Optional() @Inject(PINO_LOGGER) private readonly pino?: PinoInstance) {}

  get pinoInstance(): PinoInstance | undefined {
    return this.pino;
  }

  /**
   * 记录 Fastify 全链路 HTTP 访问日志。
   * 格式示例：`GET /api/v1/users 200 (12.3ms) - 127.0.0.1`
   * 级别映射：2xx/3xx -> info, 4xx -> warn, 5xx -> error
   */
  logHttp(payload: HttpAccessLogPayload): void {
    if (!this.pino) return;
    const { method, url, statusCode, duration, ip } = payload;
    const message = `${method} ${url} ${statusCode} (${duration}ms) - ${ip}`;
    const data = { ...payload };

    if (statusCode >= 500) {
      this.pino.error(data, message);
    } else if (statusCode >= 400) {
      this.pino.warn(data, message);
    } else {
      this.pino.info(data, message);
    }
  }

  /**
   * 记录标准应用信息日志。
   * 特性：自动过滤启动期高频但无意义的框架加载日常输出。
   */
  log(message: unknown, context?: string): void {
    this.callPino('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.callPino('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.callPino('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.callPino('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.callPino('trace', message, context);
  }

  fatal(message: unknown, stack?: string, context?: string): void {
    this.callPino('fatal', message, context, stack);
  }

  setLogLevels(levels: LogLevel[]): void {
    if (!this.pino) return;
    if (levels.includes('verbose')) {
      this.pino.level = 'trace';
    } else if (levels.includes('debug')) {
      this.pino.level = 'debug';
    } else if (levels.includes('warn')) {
      this.pino.level = 'warn';
    } else if (levels.includes('error') || levels.includes('fatal')) {
      this.pino.level = 'error';
    } else {
      this.pino.level = 'info';
    }
  }

  /** 输出应用引导启动摘要（服务地址、时区、Worker 状态、挂载的运维面板，紧凑双行输出） */
  logStartupSummary(params: {
    appUrl: string;
    timezone: string;
    isWorkerEmbedded?: boolean;
    panels: { label: string; url: string }[];
  }): void {
    const workerTag = params.isWorkerEmbedded ? ' [Worker: active]' : '';
    this.log(`[App] Server is running: ${params.appUrl} (timezone=${params.timezone})${workerTag}`);
    if (params.panels.length > 0) {
      const panelList = params.panels.map((p) => `${p.label}: ${p.url}`).join(' | ');
      this.log(`[App] ${panelList}`);
    }
  }

  private callPino(
    level: 'info' | 'warn' | 'debug' | 'trace' | 'error' | 'fatal',
    message: unknown,
    context?: string,
    err?: unknown,
  ): void {
    if (!this.pino) return;
    if (level === 'info' && context && SILENT_BOOTSTRAP_CONTEXTS.has(context)) {
      return;
    }
    const base = err === undefined ? { context } : { context, err };
    if (typeof message === 'object' && message !== null) {
      this.pino[level]({ ...base, ...message }, (message as { message?: string }).message ?? '');
    } else {
      this.pino[level](base, String(message));
    }
  }
}

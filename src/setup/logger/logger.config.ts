import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import pretty from 'pino-pretty';
import pinoRoll from 'pino-roll';
import { v7 as uuidv7 } from 'uuid';
import { isProductionEnv, PATHS } from '@/common/constants/app.constants';

/** 敏感 Token 查询参数脱敏正则（预编译复用） */
export const AUTH_QUERY_REGEX = /([?&](?:token|access_token|refresh_token)=)[^&\s]*/g;

/** 全局敏感字段脱敏路径 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.password_confirmation',
  'req.body.token',
  'req.body.secret',
];

/** HTTP 请求日志关键结构接口 */
export interface HttpAccessLog {
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  ip: string;
}

/** 提取客户端真实 IP */
export function extractIp(req: IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string) ?? req.socket?.remoteAddress ?? '-';
}

/** 请求 ID 生成所需的请求结构（IncomingMessage 与 Http2ServerRequest 均满足） */
export type RequestIdSource = {
  headers?: Record<string, unknown>;
  id?: unknown;
};

/**
 * 请求 ID 生成策略：优先透传客户端 `x-request-id`，其次复用已存在的 `req.id`，最后生成标准单调递增 `UUIDv7`。
 */
export function createRequestId(req: RequestIdSource): string {
  const incoming = req.headers?.['x-request-id'];
  if (typeof incoming === 'string' && incoming.trim()) {
    return incoming.trim();
  }
  return typeof req.id === 'string' && req.id ? req.id : uuidv7();
}

/** 脱敏 URL 中携带鉴权令牌的 query 参数 */
export function redactUrl(url?: string): string {
  return url ? url.replace(AUTH_QUERY_REGEX, '$1[redacted]') : '-';
}

/**
 * OpenTelemetry Trace-to-Log 混入：
 * 若当前执行上下文存在合法有效的活跃 Span，则自动将 trace_id 和 span_id 混入日志对象，实现 Tempo / Loki 联动。
 */
export function traceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) {
    return {};
  }
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) {
    return {};
  }
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

/**
 * 包装目标写入流，过滤掉日常健康的 HTTP 访问日志（2xx/3xx），
 * 自动保留 4xx/5xx 异常访问日志与所有应用层业务/系统日志写入按日滚动文件。
 */
export function createFileFilterStream(destination: Writable): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      try {
        const line = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object') {
          // 过滤 2xx/3xx 访问日志，4xx (WARN) 与 5xx (ERROR) 放行落盘
          const isHttpLog =
            (obj.context === 'HTTP' || (typeof obj.method === 'string' && typeof obj.ip === 'string')) &&
            typeof obj.statusCode === 'number';
          if (isHttpLog && obj.statusCode < 400) {
            callback();
            return;
          }
          // 兼容旧格式 req/res 序列化访问日志
          if (obj.req && obj.res && typeof obj.responseTime === 'number') {
            callback();
            return;
          }
        }
      } catch {
        // 非 JSON 格式直接放行
      }
      destination.write(chunk, encoding, callback);
    },
    final(callback) {
      destination.end(callback);
    },
  });
}

/**
 * 创建进程内 Pino 实例：
 * 1. 控制台：pino-pretty 彩色美化
 * 2. 存储盘：pino-roll 按日滚动切割文件（过滤掉 HTTP 访问日志，仅留应用业务日志）
 */
export async function createPinoLogger(customDestination?: Writable): Promise<pino.Logger> {
  const isProduction = isProductionEnv();
  const isTesting = process.env.APP_ENV === 'testing';

  if (customDestination) {
    return pino(
      {
        level: 'debug',
        redact: { paths: REDACT_PATHS, censor: '[redacted]' },
        mixin: traceMixin,
      },
      customDestination,
    );
  }

  const prettyFactory =
    typeof pretty === 'function' ? pretty : (pretty as unknown as { default: typeof pretty }).default;
  const prettyStream = prettyFactory({
    colorize: true,
    singleLine: true,
    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
    ignore: 'pid,hostname,method,url,statusCode,duration,ip',
  });

  const streams: Array<{ stream: Writable | pino.DestinationStream }> = [{ stream: prettyStream }];

  if (!isTesting) {
    const rollFactory =
      typeof pinoRoll === 'function' ? pinoRoll : (pinoRoll as unknown as { default: typeof pinoRoll }).default;
    const rollDestination = await rollFactory({
      file: join(process.cwd(), PATHS.STORAGE_LOGS, 'app'),
      frequency: 'daily',
      mkdir: true,
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      limit: {
        count: 14,
        removeOtherLogFiles: true,
      },
    });
    streams.push({ stream: createFileFilterStream(rollDestination) });
  }

  return pino(
    {
      level: isProduction ? 'info' : 'debug',
      redact: {
        paths: REDACT_PATHS,
        censor: '[redacted]',
      },
      mixin: traceMixin,
    },
    pino.multistream(streams),
  );
}

import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { Writable } from 'node:stream';

import { context, trace } from '@opentelemetry/api';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';

import { isProductionEnv } from '@/common/constants/app.constants';

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

/** 提取客户端真实 IP（空/纯空白头值回退至 socket，避免写入空串污染日志） */
export function extractIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded.join(', ') : forwarded;
  return value?.trim() || req.socket?.remoteAddress || '-';
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
 * 进程角色标识（api / worker）。
 *
 * 生产 JSON 日志是唯一留存通道，且 api 与独立 worker 进程产出完全同构的 JSON；
 * 采集端需要 `service` 字段区分来源。独立 worker 的入口是 `dist/workers/worker.main.js`（见 justfile `start-worker`）。
 */
export function resolveServiceName(): string {
  return basename(process.argv[1] ?? '').startsWith('worker.main') ? 'worker' : 'api';
}

/**
 * 日志-链路关联：将当前活动 span 的 trace 上下文注入日志 JSON（O2 内日志可跳转 trace）。
 *
 * OTel 未初始化或无活动 span 时零开销（一次 getSpan 查询即返回 undefined）。
 */
const traceMixin: pino.LoggerOptions['mixin'] = () => {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const { traceId, spanId, traceFlags } = span.spanContext();
  return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
};

/**
 * 创建进程内 Pino 实例（单通道 stdout）：
 * - 生产：pino 默认即为「单行 JSON 写 stdout」，零包装、零额外开销，便于容器日志驱动 / Loki 采集；
 *   同时固定 `service`/`hostname` 与 ISO 时间，便于多进程、多副本日志归集（不再依赖易变的 pid）。
 * - 开发 / 测试：pino-pretty 彩色单行，保留终端可读性。
 *
 * 不再落盘：日志留存由容器日志驱动承担（见 deploy/app/docker-compose.yml 的 json-file 上限）。
 */
export async function createPinoLogger(customDestination?: Writable): Promise<pino.Logger> {
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

  const isProduction = isProductionEnv();
  const options: pino.LoggerOptions = {
    level: isProduction ? 'info' : 'debug',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    mixin: traceMixin,
    // 开发/测试走 pretty，无需 JSON 基字段（pretty 本就忽略 pid/hostname），故只喂给生产通道
    ...(isProduction
      ? {
          base: { service: resolveServiceName(), hostname: hostname() },
          timestamp: pino.stdTimeFunctions.isoTime,
        }
      : {}),
  };

  if (isProduction) {
    return pino(options);
  }

  // pino-pretty 属 devDependencies（生产镜像 `bun install --production` 不含它）：
  // 必须动态导入，静态 import 会让生产进程在 bootstrap 阶段因找不到模块而直接退出
  const { default: pretty } = await import('pino-pretty');

  return pino(
    options,
    pretty({
      colorize: true,
      singleLine: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname,method,url,statusCode,duration,ip',
    }),
  );
}

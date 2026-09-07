import type { FastifyReply, FastifyRequest } from 'fastify';

/** Log Viewer 访问根路径 */
export const LOG_VIEWER_PATH = '/logs';

/** 单次倒序/正序读取缓冲区字节大小 (64KB) */
export const LOG_CHUNK_SIZE = 64 * 1024;

/** 单行日志最大跨块累积字节上限 (5MB 熔断保护，防止异常大对象爆内存) */
export const MAX_LOG_LINE_BYTES = 5 * 1024 * 1024;

/** 文件统计与行数 LRU 缓存最大保留条目数 */
export const MAX_STAT_CACHE_ENTRIES = 100;

/** Pino 数字级别与语义级别映射 */
export const LEVEL_MAP: Record<number, string> = {
  60: 'fatal',
  50: 'error',
  40: 'warn',
  30: 'info',
  20: 'debug',
  10: 'trace',
};

export const LEVEL_NUMBER_MAP: Record<string, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

export const ALL_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevelName = (typeof ALL_LOG_LEVELS)[number];

/** 解析后的日志条目 */
export interface ParsedLogEntry {
  id: string;
  levelNumber: number;
  level: string;
  time: number;
  timestamp: string;
  context?: string;
  msg: string;
  pid?: number;
  hostname?: string;
  reqId?: string;
  req?: {
    id?: string;
    method?: string;
    url?: string;
    headers?: Record<string, unknown>;
    remoteAddress?: string;
    remotePort?: number;
  };
  res?: {
    statusCode?: number;
  };
  responseTime?: number;
  err?: {
    type?: string;
    message?: string;
    stack?: string;
  };
  stack?: string;
  raw: Record<string, unknown>;
}

/** 日志文件元信息 */
export interface LogFileInfo {
  name: string;
  size: number;
  sizeFormatted: string;
  mtime: string;
  mtimeMs: number;
}

/** 日志查询参数 */
export interface LogEntriesQuery {
  file?: string;
  page?: string | number;
  perPage?: string | number;
  levels?: string;
  search?: string;
  direction?: 'desc' | 'asc';
}

/** 日志查询响应结果 */
export interface LogEntriesResult {
  items: ParsedLogEntry[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    countByLevel: Record<string, number>;
  };
  fileStats: {
    name: string;
    size: number;
    sizeFormatted: string;
    mtime: string;
  } | null;
  performance: {
    durationMs: number;
    memory: string;
  };
}

/** Fastify 实例最小方法契约（解耦 platform-fastify 泛型差异） */
export type FastifyLike = {
  get: (path: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown) => void;
  post: (path: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown) => void;
  delete: (path: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown) => void;
};

/** 日志流式监听查询参数 */
export interface LogStreamQuery {
  file?: string;
  levels?: string;
  search?: string;
}

/** 日志流事件 (SSE) */
export interface LogTailEvent {
  type: 'entry' | 'heartbeat' | 'error';
  entry?: ParsedLogEntry;
  timestamp?: number;
  message?: string;
}

/** 文件统计与级别计数内部缓存结构 */
export interface LogFileStatCache {
  mtimeMs: number;
  size: number;
  totalLines: number;
  countByLevel: Record<string, number>;
}

/** 格式化字节大小 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

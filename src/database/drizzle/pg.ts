import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

/** 空闲连接回收时间（毫秒） */
export const POOL_IDLE_TIMEOUT_MS = 30_000;
/** 建连超时（毫秒） */
export const POOL_CONNECT_TIMEOUT_MS = 5_000;

const poolLogger = new Logger('PgPool');

export interface CreatePgPoolOptions {
  max: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * 统一 pg 连接池工厂：主库、认证池、seeds 与集成测试共用同一套参数映射，
 * 避免超时与池上限在四处各写一份后逐渐漂移。
 */
export function createPgPool(url: string, options: CreatePgPoolOptions): Pool {
  const pool = new Pool({
    connectionString: url,
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? POOL_CONNECT_TIMEOUT_MS,
  });

  // node-postgres emits 'error' for idle clients (DB restart / failover / pg_terminate_backend).
  // Without a listener EventEmitter throws and takes the process down; log and let the pool
  // discard the connection instead.
  pool.on('error', (error) => {
    poolLogger.error(`Idle PostgreSQL client error: ${error.message}`, error.stack);
  });

  return pool;
}

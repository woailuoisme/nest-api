import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { EnvConfig } from '@/config/env.validation';
import * as schema from './schema';

/** 连接池默认配置（最佳实践值，不暴露为用户可配 env） */
const POOL_MAX = 10;
const POOL_IDLE_TIMEOUT_MS = 30_000;
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

/** Drizzle 数据库客户端依赖注入 Token */
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

/** Drizzle 强类型数据库客户端实例类型 */
export type DrizzleDB = NodePgDatabase<typeof schema>;

/** Drizzle 事务执行器上下文类型（用于在子方法或 helper 间传递 tx） */
export type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/**
 * 数据库客户端注入装饰器 — 快捷注入 DrizzleDB 实例
 *
 * @example
 * ```ts
 * constructor(@InjectDb() private readonly db: DrizzleDB) {}
 * ```
 */
export const InjectDb = () => Inject(DRIZZLE_DB);

/**
 * Drizzle 数据库服务 — 封装 pg Pool 和 drizzle-orm 客户端生命周期。
 * 全局单例，注入 ConfigService 读取 Zod 校验后的 DB_URL，OnApplicationShutdown 时自动释放连接池。
 */
@Injectable()
export class DrizzleService implements OnApplicationShutdown {
  private readonly logger = new Logger(DrizzleService.name);
  private pool: Pool;
  readonly db: DrizzleDB;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.pool = new Pool({
      connectionString: config.get('DB_URL'),
      max: POOL_MAX,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    });
    this.db = drizzle(this.pool, { schema });

    // 真实连接事件：pg.Pool 懒连接，每个新 client 建立时触发（非启动时）
    this.pool.on('connect', () => this.logger.log('Database client connected'));
    // 必须监听：空闲 client 出错（如 DB 重启）无监听器会崩进程
    this.pool.on('error', (err) => this.logger.error(`Database pool error: ${err.message}`));
  }

  async onApplicationShutdown() {
    await this.pool.end();
    this.logger.log('Database client disconnected');
  }
}

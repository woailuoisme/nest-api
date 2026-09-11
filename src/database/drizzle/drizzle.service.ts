import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { EnvConfig } from '@/config/env.validation';
import * as schema from './schema';

/** 连接池默认配置（最佳实践值，不暴露为用户可配 env） */
const POOL_MAX = 10;
const POOL_IDLE_TIMEOUT_SEC = 30;
const POOL_CONNECT_TIMEOUT_SEC = 5;

/** Drizzle 数据库客户端依赖注入 Token */
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

/** Drizzle 强类型数据库客户端实例类型 */
export type DrizzleDB = PostgresJsDatabase<typeof schema>;

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
 * Drizzle 数据库服务 — 封装 postgres.js 客户端与 drizzle-orm 生命周期。
 * 全局单例，注入 ConfigService 读取 Zod 校验后的 DB_URL，OnApplicationShutdown 时自动释放连接。
 */
@Injectable()
export class DrizzleService implements OnApplicationShutdown {
  private readonly logger = new Logger(DrizzleService.name);
  private readonly client: postgres.Sql;
  readonly db: DrizzleDB;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.client = postgres(config.get('DB_URL'), {
      max: POOL_MAX,
      idle_timeout: POOL_IDLE_TIMEOUT_SEC,
      connect_timeout: POOL_CONNECT_TIMEOUT_SEC,
      prepare: false,
      onnotice: () => {},
    });
    this.db = drizzle(this.client, { schema });
    this.logger.log('Database client initialized');
  }

  async onApplicationShutdown() {
    await this.client.end();
    this.logger.log('Database client disconnected');
  }
}

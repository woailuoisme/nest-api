import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { relations } from './relations';

/** 由连接池构造强类型 Drizzle 客户端（relations 决定 db.query 的完整类型） */
export function createDatabase(client: Pool) {
  return drizzle({ client, relations });
}

/** Drizzle 强类型数据库客户端实例类型（v1 的类型参数是 relations，而非 schema） */
export type Database = ReturnType<typeof createDatabase>;

/** 事务执行器上下文类型（用于在子方法与 helper 间传递 tx） */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

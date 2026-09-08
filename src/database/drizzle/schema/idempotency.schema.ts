import { bigint, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * 幂等键状态枚举
 * - started: 请求进入并已获取锁/租约，正在执行
 * - in_progress: 长耗时异步流程处理中
 * - completed: 执行完成，已缓存最终响应
 * - failed: 执行失败，记录错误信息以便排查或重试
 */
export type IdempotencyStatus = 'started' | 'in_progress' | 'completed' | 'failed';

/**
 * 幂等键记录表 (idempotency_keys)
 *
 * 遵循 IETF Draft (draft-ietf-httpapi-idempotency-key-header) 与 Stripe 幂等规范：
 * 1. 支持 (key, request_path, actor_type, user_id) 多租户/多端点作用域隔离；
 * 2. 存储请求参数 SHA-256 哈希值 (request_params_hash)，防止相同 key 篡改 payload 绕过；
 * 3. 记录响应状态码、Headers 与 JSON 负载，重复请求直接返回缓存响应；
 * 4. 包含 locked_at 分布式租约与 expires_at TTL 超时自动过期索引。
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    key: varchar('key', { length: 255 }).notNull(),
    userId: uuid('user_id'),
    actorType: varchar('actor_type', { length: 50 }).notNull().default('user'),
    requestMethod: varchar('request_method', { length: 10 }).notNull(),
    requestPath: varchar('request_path', { length: 512 }).notNull(),
    requestParamsHash: varchar('request_params_hash', { length: 64 }).notNull(),
    responseStatusCode: integer('response_status_code'),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
    responseBody: jsonb('response_body').$type<unknown>(),
    status: varchar('status', { length: 20 }).notNull().default('started').$type<IdempotencyStatus>(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 唯一作用域索引：防止并发重复提交
    uniqueIndex('idempotency_keys_scope_unique_idx').on(table.key, table.requestPath, table.actorType, table.userId),
    // TTL 过期清理索引：支撑后台定时清理已过期的幂等记录
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
    // 状态与更新时间复合索引：便于排查处于 processing 锁超时需释放的异常请求
    index('idempotency_keys_status_locked_at_idx').on(table.status, table.lockedAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

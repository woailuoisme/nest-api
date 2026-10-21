import type { IdempotencyStoredPayload } from '@nestjs/idempotency';
import { bigint, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * API 幂等记录与并发租约表 (idempotency_keys)
 *
 * 遵循 @nestjs/idempotency 官方规范：
 * 1. key_hash 主键：SHA-256 哈希值（64 字符十六进制），支持任意长度的 Unicode Key；
 * 2. key：原始幂等凭证文本；
 * 3. fingerprint：请求签名（HTTP 路径、主体作用域与 canonical JSON payload 哈希）；
 * 4. owner：并发占用者租约 Fencing Token（null 表示请求已处理完成）；
 * 5. response：已完成请求的完整响应（状态码、响应头与负载）；
 * 6. expires_at：过期毫秒时间戳（bigint），支持原子续租与单语句 CAS 并发认领；
 * 7. 支持基于 expires_at 的高效索引，用于清理过期租约。
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    owner: text('owner'),
    response: jsonb('response').$type<IdempotencyStoredPayload>(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idempotency_keys_expires_at_idx').on(table.expiresAt)],
);

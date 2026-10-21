import { isNull, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * 数据库通知表 (notifications)
 *
 * 遵循 Laravel Database Notifications 工业级模型规范：
 * 1. UUIDv7 主键：采用 PostgreSQL 18 原生 uuidv7() 单调递增时间戳前缀，消除 B-Tree 页分裂并内置时间排序语义；
 * 2. (notifiable_type, notifiable_id) 多态接收者关联（支持向用户、管理员或租户派发通知）；
 * 3. type 标识具体的通知类或事件类型；
 * 4. data 结构化 JSONB 负载（包含通知标题、正文、跳转链接、动作按钮等）；
 * 5. read_at 可空已读时间戳（null 为未读，非 null 记录已读时间）；
 * 6. 支持基于 read_at IS NULL 的高效部分索引，百万级通知量下毫秒级统计未读数。
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    type: varchar('type', { length: 255 }).notNull(),
    notifiableType: varchar('notifiable_type', { length: 255 }).notNull(),
    notifiableId: uuid('notifiable_id').notNull(),
    data: jsonb('data').notNull().$type<Record<string, unknown>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 用户消息箱倒序时间线索引
    index('notifications_notifiable_created_at_idx').on(
      table.notifiableType,
      table.notifiableId,
      table.createdAt.desc(),
    ),
    // 高性能未读通知部分索引 (Partial Index)
    index('notifications_unread_idx').on(table.notifiableType, table.notifiableId).where(isNull(table.readAt)),
  ],
);

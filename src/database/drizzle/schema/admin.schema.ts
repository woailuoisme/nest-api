import { relations, sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { AdminRole, AdminStatus } from '@/common/constants/roles';

/** 管理员主表 — 支撑后台独立鉴权、状态控制与审计追踪 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** 管理员显示名称 / 真实姓名 */
    name: varchar('name', { length: 255 }).notNull(),
    /** 唯一工作邮箱地址，用于后台登录 */
    email: varchar('email', { length: 255 }).notNull().unique(),
    /** argon2id 哈希后的密码 */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    /** 管理员角色：SUPER_ADMIN | ADMIN | OPERATOR */
    role: varchar('role', { length: 20 }).notNull().$type<AdminRole>().default(AdminRole.ADMIN),
    /** 账号状态：ACTIVE | DISABLED */
    status: varchar('status', { length: 20 }).notNull().$type<AdminStatus>().default(AdminStatus.ACTIVE),
    /** 管理员头像 URL */
    avatarUrl: varchar('avatar_url', { length: 512 }),
    /** 最后登录时间 */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** 最后登录 IP 地址（支持 IPv4 / IPv6） */
    lastLoginIp: varchar('last_login_ip', { length: 45 }),
    /** 创建时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 更新时间 */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_users_role_status_idx').on(table.role, table.status),
    uniqueIndex('admin_users_email_lower_idx').on(sql`LOWER(${table.email})`),
    check('admin_users_role_check', sql`${table.role} IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')`),
    check('admin_users_status_check', sql`${table.status} IN ('ACTIVE', 'DISABLED')`),
  ],
);

/** 后台管理员 Refresh Token 表 — 独立存储与吊销 */
export const adminRefreshTokens = pgTable(
  'admin_refresh_tokens',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** SHA-256 哈希后的 Refresh Token */
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    /** 所属管理员 ID */
    adminUserId: bigint('admin_user_id', { mode: 'number' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    /** Token 过期时间 */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 吊销时间（NULL 表示有效） */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** 签发时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_refresh_tokens_admin_user_id_idx').on(table.adminUserId),
    index('admin_refresh_tokens_expires_at_idx').on(table.expiresAt).where(sql`${table.revokedAt} IS NULL`),
  ],
);

// ---- Relations ----

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  refreshTokens: many(adminRefreshTokens),
}));

export const adminRefreshTokensRelations = relations(adminRefreshTokens, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [adminRefreshTokens.adminUserId],
    references: [adminUsers.id],
  }),
}));

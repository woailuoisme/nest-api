import { desc, relations, sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { Role } from '@/common/constants/roles';

/** 用户主表 — 支持密码登录、OAuth 绑定、邮箱验证、角色管理 */
export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** 用户显示名称 */
    name: varchar('name', { length: 255 }).notNull(),
    /** 唯一邮箱地址，用于登录 — 应用层入库前 lowercase，DB 侧 LOWER(email) 唯一索引兜底 */
    email: varchar('email', { length: 255 }).notNull().unique(),
    /** argon2id 哈希后的密码（OAuth 用户可能为空） */
    passwordHash: varchar('password_hash', { length: 255 }),
    /** 用户角色：ADMIN | MANAGER | USER — 默认 USER */
    role: varchar('role', { length: 20 }).notNull().$type<Role>().default(Role.USER),
    /** 邮箱验证通过时间（NULL 表示未验证） */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** 用户头像 URL */
    avatarUrl: varchar('avatar_url', { length: 512 }),
    /** 注册时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 最后更新时间 */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 支撑用户列表的 role 过滤 + createdAt DESC 排序分页
    index('users_role_created_at_idx').on(table.role, desc(table.createdAt)),
    // LOWER(email) 唯一索引 — 防止大小写变体绕过应用层归一化
    uniqueIndex('users_email_lower_idx').on(sql`LOWER(${table.email})`),
    // DB 级 role CHECK 约束，防止应用层 bug 写入非法角色
    check('users_role_check', sql`${table.role} IN ('ADMIN', 'MANAGER', 'USER')`),
  ],
);

/** JWT Refresh Token 记录 — 用户登录后生成，支持吊销与过期管理 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** SHA-256 哈希后的 Refresh Token */
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    /** 所属用户 ID */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Token 过期时间 */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 吊销时间（NULL 表示仍有效） */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Token 签发时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 支撑按用户批量吊销 refresh token（revokeAllForUser）
    index('refresh_tokens_user_id_idx').on(table.userId),
    // 部分索引 — 仅索引未吊销的有效 token，加速查找与清理
    index('refresh_tokens_expires_at_idx').on(table.expiresAt).where(sql`${table.revokedAt} IS NULL`),
  ],
);

/** OAuth 第三方登录关联 — 支持 Google 等 OAuth 2.0 Provider */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** OAuth Provider 名称（如 google） */
    provider: varchar('provider', { length: 50 }).notNull(),
    /** Provider 侧的用户唯一标识 */
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    /** 关联的本地用户 ID */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 绑定时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_accounts_provider_provider_user_id_idx').on(table.provider, table.providerUserId),
    // 支撑按用户查询第三方绑定列表
    index('oauth_accounts_user_id_idx').on(table.userId),
  ],
);

/**
 * 临时业务令牌（Ephemeral Tokens）— 统一收敛密码重置、邮箱验证 OTP、魔法链接等短期单次凭证。
 * 包含类型区分、过期判定与消费标记。
 */
export const ephemeralTokens = pgTable(
  'ephemeral_tokens',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** 令牌类型：password_reset | email_verification 等 */
    type: varchar('type', { length: 50 }).notNull(),
    /** SHA-256 哈希后的临时令牌 */
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    /** 所属用户 ID */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 令牌过期时间 */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 消费时间（NULL 表示未被使用） */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** 令牌生成时间 */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 复合索引 — 支撑按用户与令牌类型快速查找及批量作废
    index('ephemeral_tokens_user_id_type_idx').on(table.userId, table.type),
    // 部分索引 — 仅索引未使用的 token，加速定时过期清理与有效性检索
    index('ephemeral_tokens_expires_at_idx').on(table.expiresAt).where(sql`${table.usedAt} IS NULL`),
  ],
);

// ---- Relations ----

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  oauthAccounts: many(oauthAccounts),
  ephemeralTokens: many(ephemeralTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const ephemeralTokensRelations = relations(ephemeralTokens, ({ one }) => ({
  user: one(users, { fields: [ephemeralTokens.userId], references: [users.id] }),
}));

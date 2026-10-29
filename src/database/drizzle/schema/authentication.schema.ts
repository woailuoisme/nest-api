import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * @nestjs/authentication 状态表：会话、刷新令牌、TOTP、恢复码、失败计数与待处理邮件令牌。
 *
 * - 会话、刷新令牌与邮件令牌一律只存 SHA-256（base64url），库泄露也无法重放；
 * - TOTP secret 由官方 MfaService 以 AES-256-GCM 加密后写入，恢复码为 scrypt 哈希。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    lastActiveAt: at('last_active_at').notNull(),
    mfa: text('mfa', { enum: ['pending', 'verified'] }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId), index('sessions_expires_at_idx').on(table.expiresAt)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_expires_at_idx').on(table.familyExpiresAt),
  ],
);

export const mfaAuthenticators = pgTable('mfa_authenticators', {
  userId: text('user_id').primaryKey(),
  secret: text('secret').notNull(),
  confirmed: boolean('confirmed').notNull(),
  pendingSecret: text('pending_secret'),
  lastUsedStep: integer('last_used_step'),
});

export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.codeHash] })],
);

export const mfaFailures = pgTable(
  'mfa_failures',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(),
    failedAt: at('failed_at').notNull(),
  },
  (table) => [
    index('mfa_failures_user_id_failed_at_idx').on(table.userId, table.failedAt),
    index('mfa_failures_failed_at_idx').on(table.failedAt),
  ],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose', { enum: ['password-reset', 'email-verification'] }).notNull(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    fingerprint: text('fingerprint'),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (table) => [
    index('email_tokens_user_id_purpose_idx').on(table.userId, table.purpose),
    index('email_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

/** API Key：只存 key 的 SHA-256 与公开 id，明文仅在创建时返回一次 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name'),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at'),
    lastUsedAt: at('last_used_at'),
    revoked: boolean('revoked').notNull().default(false),
  },
  (table) => [index('api_keys_user_id_idx').on(table.userId), index('api_keys_expires_at_idx').on(table.expiresAt)],
);

/**
 * 邮箱 / 短信验证码：只保留最近一条有效记录，验证码以 HMAC-SHA256 摘要存储。
 *
 * `purpose` 目前只用于归属验证（邮箱 / 手机号绑定），不含免密登录语义。
 */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: text('id').primaryKey(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    target: text('target').notNull(),
    purpose: text('purpose', { enum: ['verify-email', 'verify-phone'] }).notNull(),
    userId: text('user_id'),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (table) => [
    // 同一目标 + 用途只允许一条有效验证码：配合 onConflictDoUpdate 保证并发下不会产生多行
    uniqueIndex('otp_codes_target_purpose_uidx').on(table.target, table.purpose),
    index('otp_codes_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * 验证码发送窗口（按目标 + 用途）。
 *
 * 与 `otp_codes` 解耦的原因：验证码行会被 upsert 覆盖（`created_at` 随之重置），
 * 用它统计「每小时发送次数」永远只能得到 0/1。本表独立累计窗口内次数，
 * 由单条 `INSERT ... ON CONFLICT DO UPDATE ... WHERE` 原子完成「校验 + 自增」。
 */
export const otpSendWindows = pgTable(
  'otp_send_windows',
  {
    target: text('target').notNull(),
    purpose: text('purpose', { enum: ['verify-email', 'verify-phone'] }).notNull(),
    windowStartedAt: at('window_started_at').notNull(),
    sendCount: integer('send_count').notNull().default(0),
    lastSentAt: at('last_sent_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.target, table.purpose] }),
    index('otp_send_windows_window_started_at_idx').on(table.windowStartedAt),
  ],
);

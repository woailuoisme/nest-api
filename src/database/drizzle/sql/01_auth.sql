-- =============================================================================
-- 用户 / 凭据与认证状态 DDL (PostgreSQL)
-- 100% Strictly Generated from:
--   src/database/drizzle/schema/auth.schema.ts           (user / account)
--   src/database/drizzle/schema/authentication.schema.ts (认证状态表)
--
-- ⚠️ 仅作**参考实现 / 人工核对**，权威来源是 drizzle/migrations（应用启动与 CI 只跑迁移）。
--    改表流程：修改 schema → `just db-gen` 产出迁移 → 再同步本文件。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. User Core Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean NOT NULL DEFAULT false,
    "avatar_path" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "role" text,
    "banned" boolean DEFAULT false,
    "ban_reason" text,
    "phone_number" text UNIQUE,
    "phone_number_verified" boolean DEFAULT false
);

-- -----------------------------------------------------------------------------
-- 2. Account Table (Credentials / OAuth)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "password" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");

-- -----------------------------------------------------------------------------
-- 3. Sessions (@nestjs/authentication)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" text PRIMARY KEY,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "last_active_at" timestamp with time zone NOT NULL,
    "mfa" text,
    "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- -----------------------------------------------------------------------------
-- 4. Refresh Tokens
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" text PRIMARY KEY,
    "family_id" text NOT NULL,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "family_expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "revoked" boolean DEFAULT false NOT NULL,
    "claims" jsonb
);
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_expires_at_idx" ON "refresh_tokens" ("family_expires_at");

-- -----------------------------------------------------------------------------
-- 5. TOTP Authenticators / Recovery Codes / Failures
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "mfa_authenticators" (
    "user_id" text PRIMARY KEY,
    "secret" text NOT NULL,
    "confirmed" boolean NOT NULL,
    "pending_secret" text,
    "last_used_step" integer
);

CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
    "user_id" text,
    "code_hash" text,
    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("user_id", "code_hash")
);

CREATE TABLE IF NOT EXISTS "mfa_failures" (
    "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "user_id" text NOT NULL,
    "failed_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "mfa_failures_user_id_failed_at_idx" ON "mfa_failures" ("user_id", "failed_at");
CREATE INDEX IF NOT EXISTS "mfa_failures_failed_at_idx" ON "mfa_failures" ("failed_at");

-- -----------------------------------------------------------------------------
-- 6. Email Tokens (password reset / email verification)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "email_tokens" (
    "id" text PRIMARY KEY,
    "purpose" text NOT NULL,
    "user_id" text NOT NULL,
    "email" text NOT NULL,
    "fingerprint" text,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_tokens_user_id_purpose_idx" ON "email_tokens" ("user_id", "purpose");
CREATE INDEX IF NOT EXISTS "email_tokens_expires_at_idx" ON "email_tokens" ("expires_at");

-- -----------------------------------------------------------------------------
-- 7. API Keys
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" text PRIMARY KEY,
    "user_id" text NOT NULL,
    "name" text,
    "prefix" text NOT NULL,
    "hash" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "revoked" boolean DEFAULT false NOT NULL
);
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id");
CREATE INDEX IF NOT EXISTS "api_keys_expires_at_idx" ON "api_keys" ("expires_at");

-- -----------------------------------------------------------------------------
-- 8. Email / SMS OTP Codes（归属验证，5 分钟有效）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "otp_codes" (
    "id" text PRIMARY KEY,
    "channel" text NOT NULL,
    "target" text NOT NULL,
    "purpose" text NOT NULL,
    "user_id" text,
    "code_hash" text NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "otp_codes_target_purpose_uidx" ON "otp_codes" ("target", "purpose");
CREATE INDEX IF NOT EXISTS "otp_codes_expires_at_idx" ON "otp_codes" ("expires_at");

-- -----------------------------------------------------------------------------
-- 9. OTP Send Windows（验证码发送窗口：每小时次数上限的原子计数）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "otp_send_windows" (
    "target" text NOT NULL,
    "purpose" text NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "send_count" integer DEFAULT 0 NOT NULL,
    "last_sent_at" timestamp with time zone NOT NULL,
    CONSTRAINT "otp_send_windows_target_purpose_pk" PRIMARY KEY ("target", "purpose")
);
CREATE INDEX IF NOT EXISTS "otp_send_windows_window_started_at_idx" ON "otp_send_windows" ("window_started_at");

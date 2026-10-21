-- =============================================================================
-- Better Auth Core & Plugins DDL (PostgreSQL)
-- 100% Strictly Generated from:
--   src/database/drizzle/schema/better-auth.schema.ts
--
-- ⚠️ 仅作**参考实现 / 人工核对**，权威来源是 drizzle/migrations（应用启动与 CI 只跑迁移）。
--    改表流程：插件变更 → `just ba-generate` 重生成 schema → `just db-gen` 产出迁移 → 再同步本文件。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. User Core Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean NOT NULL DEFAULT false,
    "image" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "role" text,
    "banned" boolean DEFAULT false,
    "ban_reason" text,
    "ban_expires" timestamp,
    "two_factor_enabled" boolean DEFAULT false,
    "username" text UNIQUE,
    "display_username" text,
    "phone_number" text UNIQUE,
    "phone_number_verified" boolean,
    "last_login_method" text
);

-- -----------------------------------------------------------------------------
-- 2. Session Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY,
    "expires_at" timestamp NOT NULL,
    "token" text NOT NULL UNIQUE,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "impersonated_by" text
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("user_id");

-- -----------------------------------------------------------------------------
-- 3. Account Table (OAuth & Credentials)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" timestamp,
    "refresh_token_expires_at" timestamp,
    "scope" text,
    "password" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");

-- -----------------------------------------------------------------------------
-- 4. Verification Table (Tokens & OTPs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- -----------------------------------------------------------------------------
-- 5. Two-Factor Authentication Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "two_factor" (
    "id" text PRIMARY KEY,
    "secret" text NOT NULL,
    "backup_codes" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "verified" boolean DEFAULT true,
    "failed_verification_count" integer DEFAULT 0,
    "locked_until" timestamp
);
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "two_factor" ("secret");
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "two_factor" ("user_id");

-- -----------------------------------------------------------------------------
-- 6. API Key Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "apikey" (
    "id" text PRIMARY KEY,
    "config_id" text NOT NULL DEFAULT 'default',
    "name" text,
    "start" text,
    "reference_id" text NOT NULL,
    "prefix" text,
    "key" text NOT NULL,
    "refill_interval" integer,
    "refill_amount" integer,
    "last_refill_at" timestamp,
    "enabled" boolean DEFAULT true,
    "rate_limit_enabled" boolean DEFAULT true,
    "rate_limit_time_window" integer DEFAULT 86400000,
    "rate_limit_max" integer DEFAULT 10,
    "request_count" integer DEFAULT 0,
    "remaining" integer,
    "last_request" timestamp,
    "expires_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "permissions" text,
    "metadata" text
);
CREATE INDEX IF NOT EXISTS "apikey_configId_idx" ON "apikey" ("config_id");
CREATE INDEX IF NOT EXISTS "apikey_referenceId_idx" ON "apikey" ("reference_id");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" ("key");

-- SSO / Organization / Member / Invitation / Passkey / Device Code 表随插件移除而废弃

-- -----------------------------------------------------------------------------
-- 7. JWKS Table (Key Rotation & Discovery)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "jwks" (
    "id" text PRIMARY KEY,
    "public_key" text NOT NULL,
    "private_key" text NOT NULL,
    "created_at" timestamp NOT NULL,
    "expires_at" timestamp,
    "alg" text,
    "crv" text
);

-- SSO / Organization / Member / Invitation / Passkey / Device Code 表已随插件移除（历史库回收见后续迁移）

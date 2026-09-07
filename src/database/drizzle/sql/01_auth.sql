-- =============================================================================
-- Auth Module DDL (PostgreSQL)
-- Corresponds to: src/database/drizzle/schema/auth.schema.ts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. users (用户主表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "users" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "name" varchar(255) NOT NULL,
    "email" varchar(255) NOT NULL,
    "password_hash" varchar(255),
    "role" varchar(20) NOT NULL DEFAULT 'USER',
    "email_verified_at" timestamp with time zone,
    "avatar_url" varchar(512),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "users_email_unique" UNIQUE ("email"),
    CONSTRAINT "users_role_check" CHECK ("role" IN ('ADMIN', 'MANAGER', 'USER'))
);

-- 支撑用户列表按角色筛选及创建时间倒序分页
CREATE INDEX IF NOT EXISTS "users_role_created_at_idx" ON "users" USING btree ("role", "created_at" DESC);

-- LOWER(email) 唯一索引 — 防止大小写变体绕过应用层归一化
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (LOWER("email"));

-- -----------------------------------------------------------------------------
-- 2. refresh_tokens (JWT Refresh Token 记录表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "token_hash" varchar(255) NOT NULL,
    "user_id" bigint NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE ("token_hash"),
    CONSTRAINT "refresh_tokens_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- 支撑按用户批量吊销 refresh token（revokeAllForUser）
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");

-- 部分索引 — 仅索引未吊销的有效 token，加速查找与清理
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at") WHERE "revoked_at" IS NULL;

-- -----------------------------------------------------------------------------
-- 3. oauth_accounts (OAuth 第三方登录关联表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "provider" varchar(50) NOT NULL,
    "provider_user_id" varchar(255) NOT NULL,
    "user_id" bigint NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "oauth_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- 同一 Provider 下第三方用户 ID 唯一
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_provider_user_id_idx" ON "oauth_accounts" USING btree ("provider", "provider_user_id");

-- 支撑按用户查询第三方绑定列表
CREATE INDEX IF NOT EXISTS "oauth_accounts_user_id_idx" ON "oauth_accounts" USING btree ("user_id");

-- -----------------------------------------------------------------------------
-- 4. ephemeral_tokens (统一短期临时凭证表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ephemeral_tokens" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "type" varchar(50) NOT NULL,
    "token_hash" varchar(255) NOT NULL,
    "user_id" bigint NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "ephemeral_tokens_token_hash_unique" UNIQUE ("token_hash"),
    CONSTRAINT "ephemeral_tokens_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- 复合索引 — 支撑按用户与令牌类型快速查找及批量作废
CREATE INDEX IF NOT EXISTS "ephemeral_tokens_user_id_type_idx" ON "ephemeral_tokens" USING btree ("user_id", "type");

-- 部分索引 — 仅索引未使用的 token，加速定时过期清理与有效性检索
CREATE INDEX IF NOT EXISTS "ephemeral_tokens_expires_at_idx" ON "ephemeral_tokens" USING btree ("expires_at") WHERE "used_at" IS NULL;

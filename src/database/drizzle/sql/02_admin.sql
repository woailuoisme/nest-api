-- =============================================================================
-- Admin Module DDL (PostgreSQL)
-- Corresponds to: src/database/drizzle/schema/admin.schema.ts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. admin_users (管理后台管理员主表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "name" varchar(255) NOT NULL,
    "email" varchar(255) NOT NULL,
    "password_hash" varchar(255) NOT NULL,
    "role" varchar(20) NOT NULL DEFAULT 'ADMIN',
    "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
    "avatar_url" varchar(512),
    "last_login_at" timestamp with time zone,
    "last_login_ip" varchar(45),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "admin_users_email_unique" UNIQUE ("email"),
    CONSTRAINT "admin_users_role_check" CHECK ("role" IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')),
    CONSTRAINT "admin_users_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED'))
);

-- 支撑管理员按角色和状态过滤
CREATE INDEX IF NOT EXISTS "admin_users_role_status_idx" ON "admin_users" USING btree ("role", "status");

-- LOWER(email) 唯一索引 — 防止邮箱大小写变体绕过应用层归一化
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_lower_idx" ON "admin_users" (LOWER("email"));

-- -----------------------------------------------------------------------------
-- 2. admin_refresh_tokens (后台管理员 JWT Refresh Token 记录表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "admin_refresh_tokens" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "token_hash" varchar(255) NOT NULL,
    "admin_user_id" bigint NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "admin_refresh_tokens_token_hash_unique" UNIQUE ("token_hash"),
    CONSTRAINT "admin_refresh_tokens_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE
);

-- 支撑按管理员批量查询或吊销 refresh token
CREATE INDEX IF NOT EXISTS "admin_refresh_tokens_admin_user_id_idx" ON "admin_refresh_tokens" USING btree ("admin_user_id");

-- 部分索引 — 仅索引未吊销的有效 token，加速查找与定时清理
CREATE INDEX IF NOT EXISTS "admin_refresh_tokens_expires_at_idx" ON "admin_refresh_tokens" USING btree ("expires_at") WHERE "revoked_at" IS NULL;

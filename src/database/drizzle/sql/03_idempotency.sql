-- =============================================================================
-- Idempotency Keys Module DDL (PostgreSQL)
-- Corresponds to: src/database/drizzle/schema/idempotency.schema.ts
-- =============================================================================
-- 
-- 【设计原理 (Architecture & Principles)】:
-- 1. 标准协议对齐：遵循 IETF Draft (draft-ietf-httpapi-idempotency-key-header)
--    与 Stripe 幂等架构规范，通过 HTTP Header `Idempotency-Key` 标识唯一写操作。
-- 2. 多维作用域隔离：采用 (key, request_path, actor_type, user_id) 复合唯一索引，
--    实现多租户、多主体、多 API 接口的幂等键命名空间天然隔离，避免全局 key 冲突。
-- 3. 防篡改重放校验：强制存储请求参数 SHA-256 哈希值 (request_params_hash)。当客户端
--    尝试使用相同的 Idempotency-Key 发送已被篡改的 Payload 时，触发 422/409 冲突拒绝。
-- 4. 并发租约与状态机：采用 (started -> in_progress -> completed / failed) 状态流转，
--    结合 locked_at 租约超时保护，防止高并发下多个相同请求并发穿透造成重复执行（如重复扣款）。
-- 5. 响应快照直出：请求首次执行完成后，将 response_status_code、response_headers 与
--    response_body 快照持久化。后续重试直接命中并幂等返回历史结果，零下游业务开销。
-- 6. 生命周期 TTL：配合 expires_at 索引与后台清理 Worker，自动按策略安全剔除过期记录。
--
-- 【核心作用 (Purpose & Benefits)】:
-- 1. 防连击与网络重试：彻底解决用户前端重复点击、网络超时自动重发导致的重复下单或数据脏写。
-- 2. 强一致金融级交付：为支付转账、资产变更、积分扣减等高敏感操作提供严格的 Exactly-Once 执行语义。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. idempotency_keys (API 幂等键与防重放记录表)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "key" varchar(255) NOT NULL,
    "user_id" bigint,
    "actor_type" varchar(50) NOT NULL DEFAULT 'user',
    "request_method" varchar(10) NOT NULL,
    "request_path" varchar(512) NOT NULL,
    "request_params_hash" varchar(64) NOT NULL,
    "response_status_code" integer,
    "response_headers" jsonb,
    "response_body" jsonb,
    "status" varchar(20) NOT NULL DEFAULT 'started',
    "locked_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "idempotency_keys_status_check" CHECK ("status" IN ('started', 'in_progress', 'completed', 'failed'))
);

-- 唯一作用域索引：防止并发重复提交
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_scope_unique_idx" 
ON "idempotency_keys" ("key", "request_path", "actor_type", "user_id");

-- TTL 过期清理索引：支撑后台定时清理已过期的幂等记录
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" 
ON "idempotency_keys" USING btree ("expires_at");

-- 状态与更新时间复合索引：便于排查处于锁超时需释放的异常请求
CREATE INDEX IF NOT EXISTS "idempotency_keys_status_locked_at_idx" 
ON "idempotency_keys" USING btree ("status", "locked_at");

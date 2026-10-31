-- =============================================================================
-- Features Module DDL (PostgreSQL)
-- Corresponds to:
--   - src/database/drizzle/schema/notifications.schema.ts
-- =============================================================================

-- =============================================================================
-- 1. Notifications Module
-- =============================================================================
-- 【设计原理 (Architecture & Principles)】:
-- 1. 统一多态收件箱：对齐 Laravel 数据库通知架构规范，通过 (notifiable_type, notifiable_id)
--    将通知实体与任意接收主体（如 users 普通用户、admin_users 管理员、tenants 租户）解耦绑定。
-- 2. 全局唯一 UUID 主键：方便在前端客户端、移动端 App、离线队列以及外部系统间无冲突流转与唯一标记。
-- 3. 类型驱动路由：type 字段记录强类型的通知类名称或领域事件标识（如 `OrderShippedNotification`、
--    `SecurityAlertNotification`），便于前端/客户端进行多态模板渲染、图标匹配与动作路由。
-- 4. 灵活 JSONB 负载：data 字段保存结构化通知内容（标题、正文摘要、业务上下文 ID、跳转链接、动作按钮），
--    无需因新增通知类型而变更数据库表结构。
-- 5. 极速未读计数部分索引 (Partial Index)：
--    - 针对 read_at IS NULL 建立专属部分索引 `notifications_unread_idx`；
--    - 仅索引未读通知行，大幅减少索引体积，在千万级历史通知存量下仍能以微秒级返回未读红点数字。
--
-- 【核心作用 (Purpose & Benefits)】:
-- 1. 站内信与通知中心闭环：为系统提供统一的站内信、业务预警、系统公告与安全提示的持久化存储。
-- 2. 全双工广播通道协同：与 SSE / WebSocket 实时广播无缝联动，实现「即时弹窗推流 + 数据库收件箱沉淀」。
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "notifications" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "type" varchar(255) NOT NULL,
    "notifiable_type" varchar(255) NOT NULL,
    "notifiable_id" uuid NOT NULL,
    "data" jsonb NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- 用户消息箱倒序时间线索引
CREATE INDEX IF NOT EXISTS "notifications_notifiable_created_at_idx" 
ON "notifications" USING btree ("notifiable_type", "notifiable_id", "created_at" DESC);

-- 高性能未读通知部分索引 (Partial Index)
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" 
ON "notifications" USING btree ("notifiable_type", "notifiable_id") 
WHERE "read_at" IS NULL;

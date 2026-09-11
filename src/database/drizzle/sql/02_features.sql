-- =============================================================================
-- Features Module DDL (PostgreSQL)
-- Combines: Media and Notifications
-- Note: Idempotency is powered by Redis cache & distributed locks (square1-io/laravel-idempotency pattern)
-- Corresponds to:
--   - src/database/drizzle/schema/media.schema.ts
--   - src/database/drizzle/schema/notifications.schema.ts
-- =============================================================================

-- =============================================================================
-- 1. Media Module
-- =============================================================================

-- 【设计原理 (Architecture & Principles)】:
-- 1. 工业级多态关联模型：对齐 Laravel Spatie MediaLibrary 设计，通过 (model_type, model_id,
--    collection_name) 复合维度，将媒体文件（图片/视频/文档）与任意业务模型（如 users, products,
--    articles）解耦关联，无需为每个业务实体维护独立的媒体外键或单向中间表。
-- 2. 双标识安全机制：自增 bigint id 用于内部高性能索引与外键关联，独立 uuid 字段用于对外
--    生成防遍历、防枚举的安全公开访问 URL 或 CDN 分发地址。
-- 3. 存储与衍生分离：支持主存储驱动 (disk) 与缩略图衍生驱动 (conversions_disk) 异构分离
--    （如本地 Local 临时盘 + 云端 S3/MinIO 生产分发桶），适应复杂混合云架构。
-- 4. 结构化元数据扩展：
--    - manipulations (JSONB): 记录裁剪、旋转、滤镜等图像变换处理参数；
--    - custom_properties (JSONB): 存储用户自定义元数据（如 alt 描述、原始宽高、颜色主色调、标签）；
--    - generated_conversions (JSONB): 标记异步缩略图/WebP衍生规格生成就绪状态（如 {"thumb": true}）；
--    - responsive_images (JSONB): 存储不同分辨率响应式多图定义。
-- 5. 集合内顺序性：order_column 结合 (model_type, model_id, order_column) 索引，天然支持相册拖拽排序。
--
-- 【核心作用 (Purpose & Benefits)】:
-- 1. 统一媒体资产管线：全系统所有模块的上传、转码、缩略图、回收均通过统一表结构和 MediaService 调度。
-- 2. 零侵入与零孤儿文件：支持与业务模型生命周期级联同步（如删除文章时自动触发媒体物理清理与补偿）。
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "media" (
    "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "uuid" uuid NOT NULL DEFAULT uuidv7(),
    "model_type" varchar(255) NOT NULL,
    "model_id" bigint NOT NULL,
    "collection_name" varchar(255) NOT NULL DEFAULT 'default',
    "name" varchar(255) NOT NULL,
    "file_name" varchar(255) NOT NULL,
    "mime_type" varchar(255),
    "disk" varchar(50) NOT NULL DEFAULT 'local',
    "conversions_disk" varchar(50),
    "size" bigint NOT NULL,
    "manipulations" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "custom_properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "generated_conversions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "responsive_images" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "order_column" integer,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- UUID 唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS "media_uuid_unique_idx" ON "media" ("uuid");

-- 多态集合查询复合索引：支撑 entity.getMedia('avatars') 极速检索
CREATE INDEX IF NOT EXISTS "media_model_collection_idx" 
ON "media" USING btree ("model_type", "model_id", "collection_name");

-- 集合内自定义排序索引
CREATE INDEX IF NOT EXISTS "media_model_order_idx" 
ON "media" USING btree ("model_type", "model_id", "order_column");


-- =============================================================================
-- 3. Notifications Module
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
    "notifiable_id" bigint NOT NULL,
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

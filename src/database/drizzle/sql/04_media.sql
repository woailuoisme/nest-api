-- =============================================================================
-- Media Module DDL (PostgreSQL)
-- Corresponds to: src/database/drizzle/schema/media.schema.ts
-- Aligns with: Laravel Spatie MediaLibrary Schema Specification
-- =============================================================================
-- 
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
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. media (多态媒体关联主表)
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

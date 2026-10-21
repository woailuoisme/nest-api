import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * 多态媒体附件表 (media)
 *
 * 遵循 Laravel Spatie MediaLibrary 工业级多态媒体模型规范：
 * 1. (model_type, model_id, collection_name) 支持将图片/文档/视频多态挂载到任意实体（如 users, products, posts）；
 * 2. 独立 UUIDv7 唯一标识：采用 PostgreSQL 18 原生 uuidv7() 单调递增时间戳前缀，兼具防枚举公开 URL 与极速 B-Tree 索引性能；
 * 3. 存储驱动解耦 (disk / conversions_disk)，支持主文件与衍生缩略图异构存储（如 local + s3）；
 * 4. 包含 manipulations（转换参数）、custom_properties（自定义属性如 alt/宽高）、generated_conversions（衍生图生成状态）等结构化 JSONB 字段。
 */
export const media = pgTable(
  'media',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    uuid: uuid('uuid')
      .notNull()
      .default(sql`uuidv7()`),
    modelType: varchar('model_type', { length: 255 }).notNull(),
    modelId: uuid('model_id').notNull(),
    collectionName: varchar('collection_name', { length: 255 }).notNull().default('default'),
    name: varchar('name', { length: 255 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }),
    disk: varchar('disk', { length: 50 }).notNull().default('local'),
    conversionsDisk: varchar('conversions_disk', { length: 50 }),
    size: bigint('size', { mode: 'number' }).notNull(),
    manipulations: jsonb('manipulations').notNull().default('{}').$type<Record<string, unknown>>(),
    customProperties: jsonb('custom_properties').notNull().default('{}').$type<Record<string, unknown>>(),
    generatedConversions: jsonb('generated_conversions').notNull().default('{}').$type<Record<string, boolean>>(),
    responsiveImages: jsonb('responsive_images').notNull().default('{}').$type<Record<string, unknown>>(),
    orderColumn: integer('order_column'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // UUID 全局唯一索引
    uniqueIndex('media_uuid_unique_idx').on(table.uuid),
    // 多态集合查询复合索引：支撑 entity.getMedia('avatars') 极速检索
    index('media_model_collection_idx').on(table.modelType, table.modelId, table.collectionName),
    // 集合内自定义排序索引
    index('media_model_order_idx').on(table.modelType, table.modelId, table.orderColumn),
  ],
);

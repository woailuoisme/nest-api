import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

import type { IndexSettings } from '../interfaces/search.interface';

/**
 * 分批游标读取选项
 */
export interface CursorLoaderOptions {
  batchSize: number;
  afterId?: string | number;
}

/**
 * 分批游标读取结果
 */
export interface CursorLoaderResult<TEntity> {
  records: TEntity[];
  nextCursor?: string | number;
}

/**
 * 可检索实体契约定义（对齐 Laravel Scout Model 核心契约）
 *
 * @template TEntity 数据库持久化实体类型
 * @template TDoc 搜索引擎索引文档结构类型
 */
export interface SearchableDefinition<
  TEntity = unknown,
  TDoc extends Record<string, unknown> = Record<string, unknown>,
> {
  /** 索引唯一名称（对齐 Scout searchableAs） */
  readonly index: string;
  /** 索引唯一名称（别名，兼容 indexName 习惯） */
  readonly indexName?: string;

  /** 主键字段名称，默认为 'id' */
  readonly primaryKey?: string;

  /** 索引配置（包含 searchable/filterable/sortableAttributes 等） */
  readonly settings?: IndexSettings;

  /**
   * 将数据库实体清洗/转换为可搜索文档（对齐 Scout toSearchableArray）
   * 负责剔除敏感哈希、展开扁平化搜索属性等。
   */
  toSearchableArray(entity: TEntity): TDoc;
  /** toSearchableArray 的精简别名 */
  toSearchable?(entity: TEntity): TDoc;

  /**
   * 批量根据主键 ID 加载数据库实体
   * 用于异步队列回源同步与 SearchService.searchModel() 数据水合。
   */
  loadRecords?: (db: DrizzleDB, ids: (string | number)[]) => Promise<TEntity[]>;

  /**
   * 游标分页分批读取加载器
   * 用于 search:import CLI 命令行高效全量重灌数据，防止内存溢出。
   */
  cursorLoader?: (db: DrizzleDB, options: CursorLoaderOptions) => Promise<CursorLoaderResult<TEntity>>;
}

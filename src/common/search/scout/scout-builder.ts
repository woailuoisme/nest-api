import { keyBy } from 'es-toolkit';

import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

import type { SearchDriver, SearchParams, SearchResult } from '../interfaces/search.interface';
import type { SearchableDefinition } from './searchable.interface';

/**
 * Scout 风格的流式搜索构建器
 *
 * 支持：
 * - 流畅链式 API（query, filter, where, orderBy, limit, offset, paginate）
 * - 原生 Meilisearch 命中直接返回（高亮/分词/极速）
 * - .hydrate() 自动通过 Drizzle ORM 回源加载实体并保持检索相关性重排
 */
export class ScoutSearchBuilder<TEntity = unknown, TDoc extends Record<string, unknown> = Record<string, unknown>> {
  private searchQuery = '';
  private filterConditions: string[] = [];
  private sortOrders: string[] = [];
  private resultLimit = 20;
  private resultOffset = 0;
  private shouldHydrate = false;
  private customHighlight?: string[];

  constructor(
    private readonly driver: SearchDriver,
    private readonly searchable: SearchableDefinition<TEntity, TDoc>,
    private readonly db?: DrizzleDB,
  ) {}

  /**
   * 设置搜索检索词（空字符串代表通配检索）
   */
  query(q: string): this {
    this.searchQuery = q ?? '';
    return this;
  }

  /**
   * 增加 Meilisearch 原生 filter 条件表达式
   * @example builder.filter('role = "admin" AND banned = false')
   */
  filter(filterExpr: string | string[]): this {
    if (Array.isArray(filterExpr)) {
      this.filterConditions.push(...filterExpr);
    } else if (filterExpr) {
      this.filterConditions.push(filterExpr);
    }
    return this;
  }

  /**
   * 简化 where 键值匹配（自动拼接为 Meilisearch filter 语法）
   * @example builder.where('role', 'admin').where('banned', false)
   */
  where(field: string, value: string | number | boolean): this {
    const formatted = typeof value === 'string' ? `"${value}"` : value;
    this.filterConditions.push(`${field} = ${formatted}`);
    return this;
  }

  /**
   * 设置排序规则
   * @example builder.orderBy('createdAt', 'desc')
   */
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.sortOrders.push(`${field}:${direction}`);
    return this;
  }

  /**
   * 设置分页数量上限
   */
  limit(limit: number): this {
    this.resultLimit = limit;
    return this;
  }

  /**
   * 设置分页偏移量
   */
  offset(offset: number): this {
    this.resultOffset = offset;
    return this;
  }

  /**
   * limit 的语义化别名
   */
  take(count: number): this {
    return this.limit(count);
  }

  /**
   * 设置高亮字段
   */
  highlight(attributes: string[]): this {
    this.customHighlight = attributes;
    return this;
  }

  /**
   * 标记是否回源数据库水合实体数据
   * 开启后，将根据 Meilisearch 命中主键批量回源 Drizzle 查询真实最新数据，并保持检索分值相关度排序。
   */
  hydrate(enabled = true): this {
    this.shouldHydrate = enabled;
    return this;
  }

  /**
   * 构建当前搜索请求参数
   */
  buildParams(): SearchParams {
    return {
      filter: this.filterConditions.length ? this.filterConditions.join(' AND ') : undefined,
      sort: this.sortOrders.length ? this.sortOrders : undefined,
      limit: this.resultLimit,
      offset: this.resultOffset,
      attributesToHighlight: this.customHighlight ?? ['*'],
    };
  }

  /**
   * 获取底层原始 Meilisearch 返回信封（不经过 hydrate）
   */
  async raw(): Promise<SearchResult<TDoc>> {
    return this.driver.search<TDoc>(this.searchable.index, this.searchQuery, this.buildParams());
  }

  /**
   * 执行搜索并获取结果数组
   */
  async get(): Promise<TDoc[] | TEntity[]> {
    const rawResult = await this.raw();
    return this.resolveHits(rawResult.hits);
  }

  /**
   * 获取单条命中数据（无结果返回 null）
   */
  async first(): Promise<TDoc | TEntity | null> {
    this.limit(1);
    const results = await this.get();
    return results[0] ?? null;
  }

  /**
   * 分页检索
   */
  async paginate(pageDto?: { page?: number; limit?: number }): Promise<{
    items: TDoc[] | TEntity[];
    total: number;
    page: number;
    limit: number;
    processingTimeMs: number;
  }> {
    const limit = Math.max(1, pageDto?.limit ?? 20);
    const page = Math.max(1, pageDto?.page ?? 1);
    const offset = (page - 1) * limit;

    this.limit(limit);
    this.offset(offset);

    const rawResult = await this.raw();
    const items = await this.resolveHits(rawResult.hits);

    const total = rawResult.totalHits ?? rawResult.estimatedTotalHits ?? rawResult.hits.length;

    return {
      items,
      total,
      page,
      limit,
      processingTimeMs: rawResult.processingTimeMs,
    };
  }

  /** 按需回源水合：未开启 hydrate 时直接返回搜索引擎命中 */
  private async resolveHits(hits: TDoc[]): Promise<TDoc[] | TEntity[]> {
    return this.shouldHydrate ? this.performHydration(hits) : hits;
  }

  /**
   * 按照命中相关性重海水合 Drizzle DB 实体
   */
  private async performHydration(hits: TDoc[]): Promise<TEntity[]> {
    if (!hits.length) {
      return [];
    }

    if (!this.searchable.loadRecords || !this.db) {
      throw new Error(
        `Hydration is enabled for search index "${this.searchable.index}", but loadRecords or DrizzleDB instance is missing.`,
      );
    }

    const primaryKey = this.searchable.primaryKey ?? ('id' as keyof TEntity & string);
    const hitIds = hits.map((hit) => (hit as Record<string, unknown>)[primaryKey] as string | number).filter(Boolean);

    if (!hitIds.length) {
      return [];
    }

    const dbEntities = await this.searchable.loadRecords(this.db, hitIds);
    const entityMap = keyBy(dbEntities, (entity) => String((entity as Record<string, unknown>)[primaryKey]));

    // 严谨保持 Meilisearch 相关性评分的先后顺序，过滤掉 DB 中已被物理删除的游离项
    return hitIds.map((id) => entityMap[String(id)]).filter((item): item is TEntity => Boolean(item));
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { keyBy } from 'es-toolkit';

import type { EnvConfig } from '@/config/env.validation';
import type { Database } from '@/database/drizzle/database';

import { MeiliSearchDriver } from './drivers/meilisearch.driver';
import { NoopSearchDriver } from './drivers/noop.driver';
import type {
  IndexSettings,
  PaginatedSearchResult,
  SearchDriver,
  SearchDriverHealth,
  SearchExecutionOptions,
  SearchParams,
  SearchResult,
} from './interfaces/search.interface';
import type { SearchableDefinition } from './scout/searchable.interface';

/**
 * 全文搜索引擎核心门面服务
 *
 * 负责：
 * 1. 自动根据环境变量推导加载 MeiliSearchDriver 或 NoopSearchDriver；
 * 2. 提供强类型、高内聚的 searchModel 检索与可选 Drizzle 数据水合；
 * 3. 封装直接索引增删改与健康检查接口。
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly activeDriver: SearchDriver;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectDrizzle() private readonly db: Database,
  ) {
    this.activeDriver = this.resolveDriver();
  }

  private resolveDriver(): SearchDriver {
    const driverType = this.configService.get('SCOUT_DRIVER');
    const searchUrl = this.configService.get('SEARCH_URL');

    if (driverType === 'meilisearch' && searchUrl) {
      try {
        return new MeiliSearchDriver(searchUrl);
      } catch (error) {
        this.logger.error(
          `Failed to initialize MeiliSearchDriver: ${(error as Error).message}. Falling back to NoopSearchDriver.`,
        );
        return new NoopSearchDriver();
      }
    }

    return new NoopSearchDriver();
  }

  /**
   * 获取当前生效的搜索引擎驱动
   */
  driver(): SearchDriver {
    return this.activeDriver;
  }

  /**
   * 按 Searchable 契约执行强类型模型检索，支持可选的 Drizzle 数据水合
   */
  async searchModel<TEntity = unknown, TDoc extends Record<string, unknown> = Record<string, unknown>>(
    searchable: SearchableDefinition<TEntity, TDoc>,
    options: SearchExecutionOptions = {},
  ): Promise<PaginatedSearchResult<TEntity | TDoc>> {
    const limit = Math.max(1, options.limit ?? 20);
    const page = Math.max(1, options.page ?? 1);
    const offset = options.offset ?? (page - 1) * limit;

    const rawResult = await this.activeDriver.search<TDoc>(searchable.index, options.query ?? '', {
      filter: options.filter,
      sort: options.sort,
      limit,
      offset,
      attributesToHighlight: options.highlight ?? ['*'],
    });

    const total = rawResult.totalHits ?? rawResult.estimatedTotalHits ?? rawResult.hits.length;

    if (!options.hydrate || !rawResult.hits.length) {
      return {
        items: rawResult.hits,
        total,
        page,
        limit,
        processingTimeMs: rawResult.processingTimeMs,
      };
    }

    if (!searchable.loadRecords || !this.db) {
      throw new Error(
        `Hydration is enabled for search index "${searchable.index}", but loadRecords or Database instance is missing.`,
      );
    }

    const primaryKey = searchable.primaryKey ?? ('id' as keyof TEntity & string);
    const hitIds = rawResult.hits
      .map((hit) => (hit as Record<string, unknown>)[primaryKey] as string | number)
      .filter(Boolean);

    if (!hitIds.length) {
      return {
        items: [],
        total,
        page,
        limit,
        processingTimeMs: rawResult.processingTimeMs,
      };
    }

    const dbEntities = await searchable.loadRecords(this.db, hitIds);
    const entityMap = keyBy(dbEntities, (entity) => String((entity as Record<string, unknown>)[primaryKey]));

    // 严谨保持 Meilisearch 相关性评分的先后顺序，过滤掉 DB 中已被物理删除的游离项
    const hydratedItems = hitIds.map((id) => entityMap[String(id)]).filter((item): item is TEntity => Boolean(item));

    return {
      items: hydratedItems,
      total,
      page,
      limit,
      processingTimeMs: rawResult.processingTimeMs,
    };
  }

  // ── 通用代理方法 ──────────────────────────────────────────

  async createOrUpdateIndex(indexName: string, primaryKey = 'id'): Promise<void> {
    return this.activeDriver.createOrUpdateIndex(indexName, primaryKey);
  }

  async deleteIndex(indexName: string): Promise<void> {
    return this.activeDriver.deleteIndex(indexName);
  }

  async updateSettings(indexName: string, settings: IndexSettings): Promise<void> {
    return this.activeDriver.updateSettings(indexName, settings);
  }

  async addDocuments(indexName: string, documents: Record<string, unknown>[], primaryKey = 'id'): Promise<void> {
    return this.activeDriver.addDocuments(indexName, documents, primaryKey);
  }

  async deleteDocuments(indexName: string, documentIds: (string | number)[]): Promise<void> {
    return this.activeDriver.deleteDocuments(indexName, documentIds);
  }

  async deleteDocument(indexName: string, documentId: string | number): Promise<void> {
    return this.activeDriver.deleteDocument(indexName, documentId);
  }

  async deleteAllDocuments(indexName: string): Promise<void> {
    return this.activeDriver.deleteAllDocuments(indexName);
  }

  async search<T extends Record<string, unknown> = Record<string, unknown>>(
    indexName: string,
    query: string,
    params?: SearchParams,
  ): Promise<SearchResult<T>> {
    return this.activeDriver.search<T>(indexName, query, params);
  }

  async checkHealth(): Promise<SearchDriverHealth> {
    return this.activeDriver.checkHealth();
  }
}

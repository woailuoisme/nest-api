import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.validation';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { MeiliSearchDriver } from './drivers/meilisearch.driver';
import { NoopSearchDriver } from './drivers/noop.driver';
import type {
  IndexSettings,
  SearchDriver,
  SearchDriverHealth,
  SearchParams,
  SearchResult,
} from './interfaces/search.interface';
import { ScoutSearchBuilder } from './scout/scout-builder';
import type { SearchableDefinition } from './scout/searchable.interface';

/**
 * 全文搜索引擎核心门面服务
 *
 * 负责：
 * 1. 自动根据环境变量推导加载 MeiliSearchDriver 或 NoopSearchDriver；
 * 2. 提供类似 Laravel Scout 的 ScoutSearchBuilder 链式构建检索器；
 * 3. 封装直接索引增删改与健康检查接口。
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly activeDriver: SearchDriver;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @Optional() @InjectDb() private readonly db?: DrizzleDB,
  ) {
    this.activeDriver = this.resolveDriver();
  }

  private resolveDriver(): SearchDriver {
    const driverType = this.configService.get('SEARCH_DRIVER');
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
   * 创建 Scout 风格流式搜索构建器
   *
   * @example
   * const results = await searchService.builder(userSearchable)
   *   .query('alex')
   *   .where('role', 'admin')
   *   .orderBy('createdAt', 'desc')
   *   .paginate({ page: 1, limit: 15 });
   */
  builder<TEntity = unknown, TDoc extends Record<string, unknown> = Record<string, unknown>>(
    searchable: SearchableDefinition<TEntity, TDoc>,
  ): ScoutSearchBuilder<TEntity, TDoc> {
    return new ScoutSearchBuilder(this.activeDriver, searchable, this.db);
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

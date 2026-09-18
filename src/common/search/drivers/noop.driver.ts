import { Logger } from '@nestjs/common';
import type {
  IndexSettings,
  SearchDriver,
  SearchDriverHealth,
  SearchParams,
  SearchResult,
} from '../interfaces/search.interface';

/**
 * 空操作搜索引擎驱动 (Noop Search Driver)
 *
 * 用于：
 * 1. 本地未配置 SEARCH_URL 时的静默优雅降级；
 * 2. CI/CD 测试环境中免除 Meilisearch 容器依赖；
 * 3. 索引与删除操作安全吞吐，检索操作返回空结果集。
 */
export class NoopSearchDriver implements SearchDriver {
  readonly name = 'noop';
  private readonly logger = new Logger(NoopSearchDriver.name);

  constructor() {
    this.logger.debug('Initialized NoopSearchDriver (Search is running in fallback/noop mode)');
  }

  async createOrUpdateIndex(_indexName: string, _primaryKey?: string): Promise<void> {
    // noop
  }

  async deleteIndex(_indexName: string): Promise<void> {
    // noop
  }

  async updateSettings(_indexName: string, _settings: IndexSettings): Promise<void> {
    // noop
  }

  async addDocuments(_indexName: string, _documents: Record<string, unknown>[], _primaryKey?: string): Promise<void> {
    // noop
  }

  async deleteDocuments(_indexName: string, _documentIds: (string | number)[]): Promise<void> {
    // noop
  }

  async deleteDocument(_indexName: string, _documentId: string | number): Promise<void> {
    // noop
  }

  async deleteAllDocuments(_indexName: string): Promise<void> {
    // noop
  }

  async search<T = Record<string, unknown>>(
    _indexName: string,
    query: string,
    params?: SearchParams,
  ): Promise<SearchResult<T>> {
    return {
      hits: [],
      query,
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
      estimatedTotalHits: 0,
      totalHits: 0,
      processingTimeMs: 0,
    };
  }

  async checkHealth(): Promise<SearchDriverHealth> {
    return {
      status: 'up',
      driver: 'noop',
      message: 'NoopSearchDriver is active (Meilisearch is not configured)',
    };
  }
}

import { Logger } from '@nestjs/common';
import { Meilisearch } from 'meilisearch';
import type {
  IndexSettings,
  SearchDriver,
  SearchDriverHealth,
  SearchParams,
  SearchResult,
} from '../interfaces/search.interface';
import { parseMeilisearchDsn } from '../utils/dsn.parser';

/**
 * 官方 Meilisearch 搜索引擎驱动适配器
 */
export class MeiliSearchDriver implements SearchDriver {
  readonly name = 'meilisearch';
  private readonly logger = new Logger(MeiliSearchDriver.name);
  private readonly client: Meilisearch;

  constructor(dsn: string) {
    const config = parseMeilisearchDsn(dsn);
    this.client = new Meilisearch({
      host: config.host,
      apiKey: config.apiKey,
    });
    this.logger.log(`Initialized MeiliSearchDriver pointing to ${config.host}`);
  }

  getClient(): Meilisearch {
    return this.client;
  }

  async createOrUpdateIndex(indexName: string, primaryKey = 'id'): Promise<void> {
    try {
      await this.client.getIndex(indexName);
    } catch {
      await this.client.createIndex(indexName, { primaryKey });
      this.logger.log(`Created Meilisearch index: ${indexName} (primaryKey=${primaryKey})`);
    }
  }

  async deleteIndex(indexName: string): Promise<void> {
    try {
      await this.client.deleteIndex(indexName);
      this.logger.log(`Deleted Meilisearch index: ${indexName}`);
    } catch (error) {
      this.logger.warn(`Failed to delete index ${indexName}: ${(error as Error).message}`);
    }
  }

  async updateSettings(indexName: string, settings: IndexSettings): Promise<void> {
    const index = this.client.index(indexName);
    const task = await index.updateSettings({
      searchableAttributes: settings.searchableAttributes,
      filterableAttributes: settings.filterableAttributes,
      sortableAttributes: settings.sortableAttributes,
      rankingRules: settings.rankingRules,
      stopWords: settings.stopWords,
      synonyms: settings.synonyms,
      distinctAttribute: settings.distinctAttribute,
    });
    this.logger.debug(`Updated settings for index ${indexName} (taskUid=${task.taskUid})`);
  }

  async addDocuments(indexName: string, documents: Record<string, unknown>[], primaryKey = 'id'): Promise<void> {
    if (!documents.length) return;
    const index = this.client.index(indexName);
    const task = await index.addDocuments(documents, { primaryKey });
    this.logger.debug(
      `Enqueued addDocuments for index ${indexName}: ${documents.length} docs (taskUid=${task.taskUid})`,
    );
  }

  async deleteDocuments(indexName: string, documentIds: (string | number)[]): Promise<void> {
    if (!documentIds.length) return;
    const index = this.client.index(indexName);
    const task = await index.deleteDocuments(documentIds.map(String));
    this.logger.debug(
      `Enqueued deleteDocuments for index ${indexName}: ${documentIds.length} ids (taskUid=${task.taskUid})`,
    );
  }

  async deleteDocument(indexName: string, documentId: string | number): Promise<void> {
    const index = this.client.index(indexName);
    const task = await index.deleteDocument(String(documentId));
    this.logger.debug(`Enqueued deleteDocument for index ${indexName}: id=${documentId} (taskUid=${task.taskUid})`);
  }

  async deleteAllDocuments(indexName: string): Promise<void> {
    const index = this.client.index(indexName);
    const task = await index.deleteAllDocuments();
    this.logger.log(`Flushed all documents in index ${indexName} (taskUid=${task.taskUid})`);
  }

  async search<T extends Record<string, unknown> = Record<string, unknown>>(
    indexName: string,
    query: string,
    params?: SearchParams,
  ): Promise<SearchResult<T>> {
    const index = this.client.index(indexName);
    const response = await index.search(query, {
      filter: params?.filter,
      sort: params?.sort,
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
      attributesToHighlight: params?.attributesToHighlight ?? ['*'],
      attributesToCrop: params?.attributesToCrop,
      cropLength: params?.cropLength,
      highlightPreTag: params?.highlightPreTag,
      highlightPostTag: params?.highlightPostTag,
      showMatchesPosition: params?.showMatchesPosition,
    });

    return {
      hits: response.hits as unknown as T[],
      query: response.query,
      limit: response.limit,
      offset: response.offset,
      estimatedTotalHits: response.estimatedTotalHits,
      totalHits: (response as { totalHits?: number }).totalHits,
      processingTimeMs: response.processingTimeMs,
      facetDistribution: response.facetDistribution,
    };
  }

  async checkHealth(): Promise<SearchDriverHealth> {
    try {
      const isHealthy = await this.client.isHealthy();
      if (!isHealthy) {
        return {
          status: 'down',
          driver: 'meilisearch',
          message: 'Meilisearch reported unhealthy status',
        };
      }

      const version = await this.client.getVersion();
      return {
        status: 'up',
        driver: 'meilisearch',
        version: version.pkgVersion,
      };
    } catch (error) {
      return {
        status: 'down',
        driver: 'meilisearch',
        message: (error as Error).message,
      };
    }
  }
}

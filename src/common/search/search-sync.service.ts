import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.validation';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { SearchJobs } from '@/jobs/search/search.jobs';
import type { SearchableDefinition } from './scout/searchable.interface';
import { SearchService } from './search.service';

/**
 * 搜索引擎同步服务
 *
 * 封装上层业务（如 UsersService / PostsService）向搜索引擎同步变更的高级门面：
 * 1. 自动判断是否启用异步队列同步 (SEARCH_QUEUE_ENABLED=true 且 SearchJobs 存在)；
 * 2. 若启用队列，则投递至 BullMQ search 队列，实现极速响应与削峰填谷；
 * 3. 若禁用队列或处于 CLI / 单元测试环境，则优雅降级为同步直接调用 SearchService。
 */
@Injectable()
export class SearchSyncService {
  private readonly logger = new Logger(SearchSyncService.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly configService: ConfigService<EnvConfig, true>,
    @Optional() private readonly searchJobs?: SearchJobs,
    @Optional() @InjectDb() private readonly db?: DrizzleDB,
  ) {}

  /**
   * 同步（新增或全量覆盖更新）实体文档至索引
   *
   * @param def 实体对应的 SearchableDefinition 契约定义
   * @param records 单个实体或实体列表
   */
  async sync<TEntity, TDoc extends Record<string, unknown> = Record<string, unknown>>(
    def: SearchableDefinition<TEntity, TDoc>,
    records: TEntity | TEntity[],
  ): Promise<void> {
    const list = Array.isArray(records) ? records : [records];
    if (list.length === 0) {
      return;
    }

    const indexName = this.resolveIndexName(def);
    const transform = (record: TEntity) =>
      def.toSearchable ? def.toSearchable(record) : def.toSearchableArray(record);
    const documents = list.map(transform);

    this.logger.debug(
      `Dispatching sync for ${documents.length} document(s) in index "${indexName}" (queue=${this.isQueueEnabled})`,
    );

    if (this.isQueueEnabled && this.searchJobs) {
      await this.searchJobs.dispatchIndex(indexName, documents, def.primaryKey ?? 'id');
      return;
    }

    // 同步直接执行（旁路弱依赖降级处理，避免搜索服务异常阻断主流程）
    try {
      await this.searchService.addDocuments(indexName, documents, def.primaryKey ?? 'id');
    } catch (err) {
      this.logger.warn(`Failed to sync documents to search index "${indexName}": ${(err as Error).message}`);
    }
  }

  /**
   * 通过 ID 查库并同步最新实体数据至索引
   *
   * @param def 实体对应的 SearchableDefinition 契约定义
   * @param id 文档主键 ID
   * @param customDb 可选的事务 tx 或自定义 db 实例
   */
  async syncById<TEntity, TDoc extends Record<string, unknown> = Record<string, unknown>>(
    def: SearchableDefinition<TEntity, TDoc>,
    id: string | number,
    customDb?: DrizzleDB,
  ): Promise<void> {
    const database = customDb ?? this.db;
    if (!database) {
      throw new Error('DrizzleDB instance is required to load records by ID');
    }

    if (!def.loadRecords) {
      throw new Error(`loadRecords is not implemented on searchable definition "${def.index ?? def.indexName}"`);
    }

    const records = await def.loadRecords(database, [id]);
    if (records.length > 0) {
      await this.sync(def, records[0]);
    } else {
      await this.remove(def, id);
    }
  }

  /**
   * 从索引中移除实体文档
   *
   * @param def 实体对应的 SearchableDefinition 契约定义
   * @param ids 单个或多个文档 ID
   */
  async remove<TEntity, TDoc extends Record<string, unknown> = Record<string, unknown>>(
    def: SearchableDefinition<TEntity, TDoc>,
    ids: string | number | (string | number)[],
  ): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids];
    if (idList.length === 0) {
      return;
    }

    const indexName = this.resolveIndexName(def);

    this.logger.debug(
      `Dispatching remove for ${idList.length} document(s) in index "${indexName}" (queue=${this.isQueueEnabled})`,
    );

    if (this.isQueueEnabled && this.searchJobs) {
      await this.searchJobs.dispatchDelete(indexName, idList);
      return;
    }

    // 同步直接执行（旁路弱依赖降级处理，避免搜索服务异常阻断主流程）
    try {
      await this.searchService.deleteDocuments(indexName, idList);
    } catch (err) {
      this.logger.warn(`Failed to delete documents from search index "${indexName}": ${(err as Error).message}`);
    }
  }

  /** 解析索引名：优先显式 index，其次兼容 indexName 别名 */
  private resolveIndexName(def: { index?: string; indexName?: string }): string {
    return def.index ?? def.indexName ?? '';
  }

  /** 是否启用异步队列同步（未配置时按禁用处理） */
  private get isQueueEnabled(): boolean {
    return this.configService.get('SEARCH_QUEUE_ENABLED', { infer: true }) ?? false;
  }
}

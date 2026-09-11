import { Injectable, Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { SearchService } from '@/common/search/search.service';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { SEARCHABLE_REGISTRY } from '@/database/search';

interface SearchImportOptions {
  batchSize?: number;
}

/**
 * search:import 命令 — 全量导入指定模型数据至搜索索引
 * @example just cmd search:import user --batch-size 500
 */
@Command({
  name: 'search:import',
  description: 'Import records from database into search index (e.g. search:import user)',
  arguments: '<model>',
})
@Injectable()
export class SearchImportCommand extends CommandRunner {
  private readonly logger = new Logger(SearchImportCommand.name);

  constructor(
    private readonly searchService: SearchService,
    @InjectDb() private readonly db: DrizzleDB,
  ) {
    super();
  }

  async run(passedParams: string[], options?: SearchImportOptions): Promise<void> {
    const modelName = passedParams[0]?.toLowerCase();
    if (!modelName) {
      this.logger.error(`Missing model argument. Available models: ${Object.keys(SEARCHABLE_REGISTRY).join(', ')}`);
      return;
    }

    const def = SEARCHABLE_REGISTRY[modelName];
    if (!def) {
      this.logger.error(
        `Unknown model "${modelName}". Available models: ${Object.keys(SEARCHABLE_REGISTRY).join(', ')}`,
      );
      return;
    }

    const batchSize = options?.batchSize ?? 500;
    const indexName = def.index ?? def.indexName ?? modelName;

    this.logger.log(`Starting import for model "${modelName}" into search index "${indexName}"...`);

    // 1. 同步配置
    if (def.settings) {
      await this.searchService.updateSettings(indexName, def.settings);
      this.logger.log(`Index settings synced for "${indexName}".`);
    }

    // 2. 游标分批读取与导入
    if (!def.cursorLoader) {
      this.logger.error(`cursorLoader is not defined on searchable definition for "${modelName}".`);
      return;
    }

    let afterId: string | number | undefined;
    let totalImported = 0;

    while (true) {
      const { records, nextCursor } = await def.cursorLoader(this.db, { batchSize, afterId });
      if (!records || records.length === 0) {
        break;
      }

      const transform = (record: unknown) =>
        def.toSearchable ? def.toSearchable(record) : def.toSearchableArray(record);
      const documents = records.map(transform);

      await this.searchService.addDocuments(indexName, documents, def.primaryKey ?? 'id');
      totalImported += documents.length;

      this.logger.log(`Imported batch of ${documents.length} records (total so far: ${totalImported})`);

      if (!nextCursor) {
        break;
      }
      afterId = nextCursor;
    }

    this.logger.log(`Successfully imported ${totalImported} records into index "${indexName}".`);
  }

  @Option({
    flags: '-b, --batch-size <number>',
    description: 'Number of records to process per batch (default: 500)',
  })
  parseBatchSize(val: string): number {
    return Number.parseInt(val, 10);
  }
}

/**
 * search:flush 命令 — 清空指定模型的搜索索引文档
 * @example just cmd search:flush user
 */
@Command({
  name: 'search:flush',
  description: 'Flush all documents from a search index (e.g. search:flush user)',
  arguments: '<model>',
})
@Injectable()
export class SearchFlushCommand extends CommandRunner {
  private readonly logger = new Logger(SearchFlushCommand.name);

  constructor(private readonly searchService: SearchService) {
    super();
  }

  async run(passedParams: string[]): Promise<void> {
    const modelName = passedParams[0]?.toLowerCase();
    if (!modelName) {
      this.logger.error(`Missing model argument. Available models: ${Object.keys(SEARCHABLE_REGISTRY).join(', ')}`);
      return;
    }

    const def = SEARCHABLE_REGISTRY[modelName];
    if (!def) {
      this.logger.error(
        `Unknown model "${modelName}". Available models: ${Object.keys(SEARCHABLE_REGISTRY).join(', ')}`,
      );
      return;
    }

    const indexName = def.index ?? def.indexName ?? modelName;
    this.logger.log(`Flushing all documents from index "${indexName}"...`);
    await this.searchService.deleteAllDocuments(indexName);
    this.logger.log(`Successfully flushed all documents from index "${indexName}".`);
  }
}

/**
 * search:sync-settings 命令 — 将定义中的可搜索/可过滤/排序配置推送到搜索引擎
 * @example just cmd search:sync-settings [model]
 */
@Command({
  name: 'search:sync-settings',
  description: 'Sync index settings (searchable/filterable/sortable attributes) to search engine',
  arguments: '[model]',
})
@Injectable()
export class SearchSyncSettingsCommand extends CommandRunner {
  private readonly logger = new Logger(SearchSyncSettingsCommand.name);

  constructor(private readonly searchService: SearchService) {
    super();
  }

  async run(passedParams: string[]): Promise<void> {
    const modelName = passedParams[0]?.toLowerCase();

    if (modelName) {
      const def = SEARCHABLE_REGISTRY[modelName];
      if (!def) {
        this.logger.error(
          `Unknown model "${modelName}". Available models: ${Object.keys(SEARCHABLE_REGISTRY).join(', ')}`,
        );
        return;
      }
      const indexName = def.index ?? def.indexName ?? modelName;
      if (def.settings) {
        await this.searchService.updateSettings(indexName, def.settings);
        this.logger.log(`Successfully synced settings for index "${indexName}".`);
      } else {
        this.logger.warn(`No settings found for model "${modelName}".`);
      }
      return;
    }

    // 全量同步所有注册的实体配置
    const processedIndexes = new Set<string>();
    for (const [key, def] of Object.entries(SEARCHABLE_REGISTRY)) {
      const indexName = def.index ?? def.indexName ?? key;
      if (processedIndexes.has(indexName)) continue;
      processedIndexes.add(indexName);

      if (def.settings) {
        await this.searchService.updateSettings(indexName, def.settings);
        this.logger.log(`Successfully synced settings for index "${indexName}".`);
      }
    }
  }
}

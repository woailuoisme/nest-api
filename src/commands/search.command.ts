import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Command, CommandRunner, Option } from 'nest-commander';

import { SearchService } from '@/common/search/search.service';
import type { Database } from '@/database/drizzle/database';
import { SEARCHABLE_REGISTRY } from '@/database/search';

interface SearchImportOptions {
  batchSize?: number;
}

type SearchableDef = (typeof SEARCHABLE_REGISTRY)[string];

/** 已注册模型清单（错误提示用） */
function availableModels(): string {
  return Object.keys(SEARCHABLE_REGISTRY).join(', ');
}

/** 索引名解析：显式 index > 兼容 indexName > 注册键 */
function indexNameOf(def: SearchableDef, fallback: string): string {
  return def.index ?? def.indexName ?? fallback;
}

/** Resolve a model name into its searchable definition; logs available models and returns null when missing/unknown */
function resolveModel(
  logger: Logger,
  rawModel: string | undefined,
): { modelName: string; def: SearchableDef; indexName: string } | null {
  const modelName = rawModel?.toLowerCase();

  if (!modelName) {
    logger.error(`Missing model argument. Available models: ${availableModels()}`);
    return null;
  }

  const def = SEARCHABLE_REGISTRY[modelName];
  if (!def) {
    logger.error(`Unknown model "${modelName}". Available models: ${availableModels()}`);
    return null;
  }

  return { modelName, def, indexName: indexNameOf(def, modelName) };
}

/**
 * search:import — bulk import a model's records into the search index
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
    @InjectDrizzle() private readonly db: Database,
  ) {
    super();
  }

  async run(passedParams: string[], options?: SearchImportOptions): Promise<void> {
    const resolved = resolveModel(this.logger, passedParams[0]);
    if (!resolved) return;

    const { modelName, def, indexName } = resolved;
    const batchSize = options?.batchSize ?? 500;

    this.logger.log(`Starting import for model "${modelName}" into search index "${indexName}"...`);

    // 1. Sync index settings
    if (def.settings) {
      await this.searchService.updateSettings(indexName, def.settings);
      this.logger.log(`Index settings synced for "${indexName}".`);
    }

    // 2. Cursor-paginated batched import
    if (!def.cursorLoader) {
      this.logger.error(`cursorLoader is not defined on searchable definition for "${modelName}".`);
      return;
    }

    const transform = (record: unknown) =>
      def.toSearchable ? def.toSearchable(record) : def.toSearchableArray(record);

    let afterId: string | number | undefined;
    let totalImported = 0;

    while (true) {
      const { records, nextCursor } = await def.cursorLoader(this.db, { batchSize, afterId });
      if (!records || records.length === 0) {
        break;
      }

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
 * search:flush — delete all documents from a model's search index
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
    const resolved = resolveModel(this.logger, passedParams[0]);
    if (!resolved) return;

    const { indexName } = resolved;
    this.logger.log(`Flushing all documents from index "${indexName}"...`);
    await this.searchService.deleteAllDocuments(indexName);
    this.logger.log(`Successfully flushed all documents from index "${indexName}".`);
  }
}

/**
 * search:sync-settings — push searchable/filterable/sortable settings to the search engine
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

    if (modelName && !SEARCHABLE_REGISTRY[modelName]) {
      this.logger.error(`Unknown model "${modelName}". Available models: ${availableModels()}`);
      return;
    }

    // 指定模型时只处理它，否则遍历全部注册项；按索引名去重避免重复推送
    const targets: [string, SearchableDef][] = modelName
      ? [[modelName, SEARCHABLE_REGISTRY[modelName]]]
      : Object.entries(SEARCHABLE_REGISTRY);
    const processedIndexes = new Set<string>();

    for (const [key, def] of targets) {
      const indexName = indexNameOf(def, key);
      if (processedIndexes.has(indexName)) continue;
      processedIndexes.add(indexName);

      if (!def.settings) {
        // 仅在显式指定模型时警告：全量遍历时无配置属正常状态
        if (modelName) this.logger.warn(`No settings found for model "${modelName}".`);
        continue;
      }

      await this.searchService.updateSettings(indexName, def.settings);
      this.logger.log(`Successfully synced settings for index "${indexName}".`);
    }
  }
}

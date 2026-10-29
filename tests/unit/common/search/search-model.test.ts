import { describe, expect, it, vi } from 'vitest';

import type { SearchDriver, SearchResult } from '@/common/search/interfaces/search.interface';
import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import { SearchService } from '@/common/search/search.service';
import type { Database } from '@/database/drizzle/database';

describe('SearchService.searchModel (模型检索与水合)', () => {
  type TestItem = {
    id: string;
    title: string;
    role: string;
  };

  const mockSearchable: SearchableDefinition<TestItem, TestItem> = {
    index: 'test_items',
    primaryKey: 'id',
    toSearchableArray: (item) => item,
    loadRecords: vi.fn(),
  };

  const createMockDriver = (hits: TestItem[] = []): SearchDriver => ({
    name: 'mock',
    createOrUpdateIndex: vi.fn(),
    deleteIndex: vi.fn(),
    updateSettings: vi.fn(),
    addDocuments: vi.fn(),
    deleteDocuments: vi.fn(),
    deleteDocument: vi.fn(),
    deleteAllDocuments: vi.fn(),
    search: vi.fn().mockResolvedValue({
      hits,
      query: '',
      limit: 20,
      offset: 0,
      totalHits: hits.length,
      estimatedTotalHits: hits.length,
      processingTimeMs: 2,
    } as SearchResult<TestItem>),
    checkHealth: vi.fn(),
  });

  const createSearchService = (driver: SearchDriver, db: Database = {} as Database): SearchService => {
    const configService = { get: vi.fn().mockReturnValue('noop') } as any;
    const service = new SearchService(configService, db);
    (service as any).activeDriver = driver;
    return service;
  };

  it('非 hydrate 模式下 searchModel 应直接返回 hits', async () => {
    const hits: TestItem[] = [
      { id: '1', title: 'First', role: 'user' },
      { id: '2', title: 'Second', role: 'admin' },
    ];
    const driver = createMockDriver(hits);
    const service = createSearchService(driver);

    const result = await service.searchModel(mockSearchable, {
      query: 'test',
      filter: 'role = "admin"',
      sort: ['createdAt:desc'],
      page: 2,
      limit: 10,
    });

    expect(driver.search).toHaveBeenCalledWith('test_items', 'test', {
      filter: 'role = "admin"',
      sort: ['createdAt:desc'],
      limit: 10,
      offset: 10,
      attributesToHighlight: ['*'],
    });
    expect(result.items).toEqual(hits);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(2);
  });

  it('hydrate 开启但缺少 db 或 loadRecords 时应抛出明确异常', async () => {
    const hits: TestItem[] = [{ id: '1', title: 'Item', role: 'user' }];
    const driver = createMockDriver(hits);
    const searchableWithoutLoader: SearchableDefinition<TestItem, TestItem> = {
      index: 'no_loader',
      toSearchableArray: (i) => i,
    };
    const service = createSearchService(driver, {} as Database);

    await expect(service.searchModel(searchableWithoutLoader, { hydrate: true })).rejects.toThrow(
      'Hydration is enabled for search index "no_loader", but loadRecords or Database instance is missing',
    );
  });

  it('hydrate 开启时应回源加载 DB 并严格保持 Meilisearch 命中相关性顺序，过滤掉已被删除的孤儿记录', async () => {
    // 搜索命中顺序为: id "3", "1", "2"
    const hits: TestItem[] = [
      { id: '3', title: 'Hit 3', role: 'user' },
      { id: '1', title: 'Hit 1', role: 'user' },
      { id: '2', title: 'Hit 2', role: 'user' },
    ];
    const driver = createMockDriver(hits);

    // 假设数据库返回的乱序且 id "2" 已在 DB 中被删除
    const dbRecords: TestItem[] = [
      { id: '1', title: 'DB 1 (Latest)', role: 'user' },
      { id: '3', title: 'DB 3 (Latest)', role: 'admin' },
    ];

    const mockDb = {} as Database;
    const searchableWithLoader: SearchableDefinition<TestItem, TestItem> = {
      index: 'test_items',
      primaryKey: 'id',
      toSearchableArray: (i) => i,
      loadRecords: vi.fn().mockResolvedValue(dbRecords),
    };

    const service = createSearchService(driver, mockDb);
    const result = await service.searchModel(searchableWithLoader, { hydrate: true });

    expect(searchableWithLoader.loadRecords).toHaveBeenCalledWith(mockDb, ['3', '1', '2']);
    // 预期顺序严格与 hits 顺序匹配: "3", 然后 "1"；"2" 自动剔除
    expect(result.items).toEqual([
      { id: '3', title: 'DB 3 (Latest)', role: 'admin' },
      { id: '1', title: 'DB 1 (Latest)', role: 'user' },
    ]);
  });
});

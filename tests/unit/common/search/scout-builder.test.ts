import { describe, expect, it, vi } from 'vitest';
import type { SearchDriver, SearchResult } from '@/common/search/interfaces/search.interface';
import { ScoutSearchBuilder } from '@/common/search/scout/scout-builder';
import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

describe('ScoutSearchBuilder', () => {
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

  it('链式调用应正确组装 Meilisearch 参数 (filter, where, orderBy, limit, offset)', () => {
    const driver = createMockDriver();
    const builder = new ScoutSearchBuilder(driver, mockSearchable);

    builder
      .query('keyword')
      .where('role', 'admin')
      .where('active', true)
      .filter('score > 50')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .offset(20)
      .highlight(['title']);

    const params = builder.buildParams();
    expect(params.filter).toBe('role = "admin" AND active = true AND score > 50');
    expect(params.sort).toEqual(['createdAt:desc']);
    expect(params.limit).toBe(10);
    expect(params.offset).toBe(20);
    expect(params.attributesToHighlight).toEqual(['title']);
  });

  it('非 hydrate 模式下 get() 应直接返回 hits', async () => {
    const hits: TestItem[] = [
      { id: '1', title: 'First', role: 'user' },
      { id: '2', title: 'Second', role: 'admin' },
    ];
    const driver = createMockDriver(hits);
    const builder = new ScoutSearchBuilder(driver, mockSearchable);

    const result = await builder.query('test').get();
    expect(driver.search).toHaveBeenCalledWith('test_items', 'test', expect.any(Object));
    expect(result).toEqual(hits);
  });

  it('first() 应设置 limit 为 1 并返回首条结果或 null', async () => {
    const hits: TestItem[] = [{ id: '1', title: 'Only', role: 'user' }];
    const driver = createMockDriver(hits);
    const builder = new ScoutSearchBuilder(driver, mockSearchable);

    const first = await builder.first();
    expect(first).toEqual(hits[0]);

    const emptyDriver = createMockDriver([]);
    const emptyBuilder = new ScoutSearchBuilder(emptyDriver, mockSearchable);
    const emptyResult = await emptyBuilder.first();
    expect(emptyResult).toBeNull();
  });

  it('paginate() 应计算正确的 offset 并包装分页元信息', async () => {
    const hits: TestItem[] = [{ id: '3', title: 'P3', role: 'user' }];
    const driver = createMockDriver(hits);
    const builder = new ScoutSearchBuilder(driver, mockSearchable);

    const pageResult = await builder.paginate({ page: 2, limit: 10 });
    expect(builder.buildParams().offset).toBe(10);
    expect(builder.buildParams().limit).toBe(10);
    expect(pageResult.page).toBe(2);
    expect(pageResult.limit).toBe(10);
    expect(pageResult.items).toEqual(hits);
  });

  it('hydrate 开启但缺少 db 或 loadRecords 时应抛出明确异常', async () => {
    const hits: TestItem[] = [{ id: '1', title: 'Item', role: 'user' }];
    const driver = createMockDriver(hits);
    const searchableWithoutLoader: SearchableDefinition<TestItem, TestItem> = {
      index: 'no_loader',
      toSearchableArray: (i) => i,
    };
    const builder = new ScoutSearchBuilder(driver, searchableWithoutLoader, {} as DrizzleDB);

    await expect(builder.hydrate(true).get()).rejects.toThrow(
      'Hydration is enabled for search index "no_loader", but loadRecords or DrizzleDB instance is missing',
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

    const mockDb = {} as DrizzleDB;
    const searchableWithLoader: SearchableDefinition<TestItem, TestItem> = {
      index: 'test_items',
      primaryKey: 'id',
      toSearchableArray: (i) => i,
      loadRecords: vi.fn().mockResolvedValue(dbRecords),
    };

    const builder = new ScoutSearchBuilder(driver, searchableWithLoader, mockDb);
    const hydrated = await builder.hydrate(true).get();

    expect(searchableWithLoader.loadRecords).toHaveBeenCalledWith(mockDb, ['3', '1', '2']);
    // 预期顺序严格与 hits 顺序匹配: "3", 然后 "1"；"2" 自动剔除
    expect(hydrated).toEqual([
      { id: '3', title: 'DB 3 (Latest)', role: 'admin' },
      { id: '1', title: 'DB 1 (Latest)', role: 'user' },
    ]);
  });
});

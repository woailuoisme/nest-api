import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import { SearchSyncService } from '@/common/search/search-sync.service';
import type { SearchService } from '@/common/search/search.service';
import type { EnvConfig } from '@/config/env.validation';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import type { SearchJobs } from '@/jobs/search/search.jobs';

describe('SearchSyncService', () => {
  type DummyUser = {
    id: string;
    name: string;
    email: string;
  };

  const dummySearchable: SearchableDefinition<DummyUser, DummyUser> = {
    index: 'users',
    primaryKey: 'id',
    toSearchableArray: (u) => ({ id: u.id, name: u.name, email: u.email }),
    loadRecords: vi.fn(),
  };

  let mockSearchService: {
    addDocuments: ReturnType<typeof vi.fn>;
    deleteDocuments: ReturnType<typeof vi.fn>;
  };
  let mockSearchJobs: {
    dispatchIndex: ReturnType<typeof vi.fn>;
    dispatchDelete: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockDb: DrizzleDB;

  beforeEach(() => {
    mockSearchService = {
      addDocuments: vi.fn().mockResolvedValue(undefined),
      deleteDocuments: vi.fn().mockResolvedValue(undefined),
    };
    mockSearchJobs = {
      dispatchIndex: vi.fn().mockResolvedValue(undefined),
      dispatchDelete: vi.fn().mockResolvedValue(undefined),
    };
    mockConfigService = {
      get: vi.fn().mockReturnValue(false), // 默认同步模式
    };
    mockDb = {} as DrizzleDB;
  });

  it('未开启队列时，sync 应直接调用 SearchService.addDocuments', async () => {
    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    const user: DummyUser = { id: 'u1', name: 'Alice', email: 'alice@example.com' };
    await service.sync(dummySearchable, user);

    expect(mockSearchService.addDocuments).toHaveBeenCalledWith('users', [user], 'id');
    expect(mockSearchJobs.dispatchIndex).not.toHaveBeenCalled();
  });

  it('开启队列 (SEARCH_QUEUE_ENABLED=true) 且有 SearchJobs 时，sync 应投递至 BullMQ 任务', async () => {
    mockConfigService.get.mockReturnValue(true);

    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    const user: DummyUser = { id: 'u1', name: 'Alice', email: 'alice@example.com' };
    await service.sync(dummySearchable, user);

    expect(mockSearchJobs.dispatchIndex).toHaveBeenCalledWith('users', [user], 'id');
    expect(mockSearchService.addDocuments).not.toHaveBeenCalled();
  });

  it('传入空数组时 sync 与 remove 应安全早退不执行任何调用', async () => {
    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    await service.sync(dummySearchable, []);
    await service.remove(dummySearchable, []);

    expect(mockSearchService.addDocuments).not.toHaveBeenCalled();
    expect(mockSearchService.deleteDocuments).not.toHaveBeenCalled();
  });

  it('remove 在未开启队列时应直接调用 SearchService.deleteDocuments', async () => {
    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    await service.remove(dummySearchable, 'u1');
    expect(mockSearchService.deleteDocuments).toHaveBeenCalledWith('users', ['u1']);
  });

  it('remove 在开启队列时应投递至 SearchJobs.dispatchDelete', async () => {
    mockConfigService.get.mockReturnValue(true);

    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    await service.remove(dummySearchable, ['u1', 'u2']);
    expect(mockSearchJobs.dispatchDelete).toHaveBeenCalledWith('users', ['u1', 'u2']);
  });

  it('syncById 应查库并同步最新数据，若不存在则调用 remove 清理索引', async () => {
    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    const foundUser: DummyUser = { id: 'u10', name: 'Bob', email: 'bob@example.com' };
    vi.mocked(dummySearchable.loadRecords!).mockResolvedValueOnce([foundUser]);

    await service.syncById(dummySearchable, 'u10');
    expect(mockSearchService.addDocuments).toHaveBeenCalledWith('users', [foundUser], 'id');

    // 模拟数据库未查到记录（已被物理删除）
    vi.mocked(dummySearchable.loadRecords!).mockResolvedValueOnce([]);
    await service.syncById(dummySearchable, 'u999');
    expect(mockSearchService.deleteDocuments).toHaveBeenCalledWith('users', ['u999']);
  });

  it('未开启队列且 searchService.addDocuments 异常时，sync 应记录警告并安全降级不抛出异常', async () => {
    mockSearchService.addDocuments.mockRejectedValueOnce(new Error('Meilisearch connection refused'));

    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    const user: DummyUser = { id: 'u1', name: 'Alice', email: 'alice@example.com' };
    await expect(service.sync(dummySearchable, user)).resolves.toBeUndefined();
    expect(mockSearchService.addDocuments).toHaveBeenCalledWith('users', [user], 'id');
  });

  it('未开启队列且 searchService.deleteDocuments 异常时，remove 应记录警告并安全降级不抛出异常', async () => {
    mockSearchService.deleteDocuments.mockRejectedValueOnce(new Error('Meilisearch timeout'));

    const service = new SearchSyncService(
      mockSearchService as unknown as SearchService,
      mockConfigService as unknown as ConfigService<EnvConfig, true>,
      mockSearchJobs as unknown as SearchJobs,
      mockDb,
    );

    await expect(service.remove(dummySearchable, 'u1')).resolves.toBeUndefined();
    expect(mockSearchService.deleteDocuments).toHaveBeenCalledWith('users', ['u1']);
  });
});

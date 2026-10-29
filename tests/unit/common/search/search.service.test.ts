import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeiliSearchDriver } from '@/common/search/drivers/meilisearch.driver';
import { NoopSearchDriver } from '@/common/search/drivers/noop.driver';
import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import { SearchService } from '@/common/search/search.service';
import type { EnvConfig } from '@/config/env.validation';
import type { Database } from '@/database/drizzle/database';

describe('SearchService 核心门面', () => {
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  const mockDb = {} as Database;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn(),
    };
  });

  it('未配置 SEARCH_URL 或 SCOUT_DRIVER=noop 时应默认加载 NoopSearchDriver', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'SCOUT_DRIVER') return 'noop';
      return undefined;
    });

    const service = new SearchService(mockConfigService as unknown as ConfigService<EnvConfig, true>, mockDb);
    expect(service.driver()).toBeInstanceOf(NoopSearchDriver);
    expect(service.driver().name).toBe('noop');
  });

  it('配置 SCOUT_DRIVER=meilisearch 且带有合法 SEARCH_URL 时应加载 MeiliSearchDriver', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'SCOUT_DRIVER') return 'meilisearch';
      if (key === 'SEARCH_URL') return 'meilisearch://masterKey@127.0.0.1:7700';
      return undefined;
    });

    const service = new SearchService(mockConfigService as unknown as ConfigService<EnvConfig, true>, mockDb);
    expect(service.driver()).toBeInstanceOf(MeiliSearchDriver);
    expect(service.driver().name).toBe('meilisearch');
  });

  it('MeiliSearchDriver 初始化失败（如非法 DSN）时应优雅降级为 NoopSearchDriver', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'SCOUT_DRIVER') return 'meilisearch';
      if (key === 'SEARCH_URL') return ':::bad-dsn:::';
      return undefined;
    });

    const service = new SearchService(mockConfigService as unknown as ConfigService<EnvConfig, true>, mockDb);
    expect(service.driver()).toBeInstanceOf(NoopSearchDriver);
  });

  it('searchModel() 应调用底层驱动完成检索并返回标准化分页信封', async () => {
    mockConfigService.get.mockReturnValue('noop');
    const service = new SearchService(mockConfigService as unknown as ConfigService<EnvConfig, true>, mockDb);

    const dummySearchable: SearchableDefinition<any, any> = {
      index: 'dummy',
      toSearchableArray: (x) => x,
    };

    const res = await service.searchModel(dummySearchable, { query: 'hello', page: 1, limit: 10 });
    expect(res).toBeDefined();
    expect(res.page).toBe(1);
    expect(res.limit).toBe(10);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });
});

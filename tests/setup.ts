import { vi } from 'vitest';

/**
 * Vitest 全局 setup
 *
 * 在测试运行前统一配置环境变量与全局行为。
 * 各 vitest config 通过 setupFiles 引用此文件。
 */

// 强制测试环境标识（补充 vitest config 中的 env 设置）
process.env.APP_ENV = 'testing';

// 全局 Mock meilisearch 客户端，防止并发单元测试时连接宿主机 7700 端口
vi.mock('meilisearch', () => {
  const mockIndexInstance = {
    updateSettings: vi.fn().mockResolvedValue({ taskUid: 1 }),
    addDocuments: vi.fn().mockResolvedValue({ taskUid: 2 }),
    deleteDocuments: vi.fn().mockResolvedValue({ taskUid: 3 }),
    deleteDocument: vi.fn().mockResolvedValue({ taskUid: 4 }),
    deleteAllDocuments: vi.fn().mockResolvedValue({ taskUid: 5 }),
    search: vi.fn().mockResolvedValue({
      hits: [{ id: '1', name: 'Hit 1' }],
      query: 'search-term',
      limit: 20,
      offset: 0,
      estimatedTotalHits: 1,
      totalHits: 1,
      processingTimeMs: 4,
      facetDistribution: {},
    }),
  };

  class MockMeilisearch {
    getIndex = vi.fn().mockRejectedValue(new Error('Index not found'));
    createIndex = vi.fn().mockResolvedValue({ taskUid: 10 });
    deleteIndex = vi.fn().mockResolvedValue({ taskUid: 11 });
    index = vi.fn().mockReturnValue(mockIndexInstance);
    isHealthy = vi.fn().mockResolvedValue(true);
    getVersion = vi.fn().mockResolvedValue({ pkgVersion: '1.12.0' });
  }

  return { Meilisearch: MockMeilisearch, default: { Meilisearch: MockMeilisearch } };
});

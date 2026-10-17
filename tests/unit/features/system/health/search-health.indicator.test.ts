import type { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchService } from '@/common/search/search.service';
import { SearchHealthIndicator } from '@/features/system/health/indicators/search-health.indicator';

describe('SearchHealthIndicator 搜索引擎健康检查', () => {
  let indicator: SearchHealthIndicator;
  let mockSearchService: {
    checkHealth: ReturnType<typeof vi.fn>;
  };
  let mockHealthIndicatorService: {
    check: ReturnType<typeof vi.fn>;
  };
  let mockIndicatorBuilder: {
    up: ReturnType<typeof vi.fn>;
    down: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockIndicatorBuilder = {
      up: vi.fn().mockImplementation((data) => ({ search: { status: 'up', ...data } })),
      down: vi.fn().mockImplementation((data) => ({ search: { status: 'down', ...data } })),
    };

    mockHealthIndicatorService = {
      check: vi.fn().mockReturnValue(mockIndicatorBuilder),
    };

    mockSearchService = {
      checkHealth: vi.fn(),
    };

    indicator = new SearchHealthIndicator(
      mockSearchService as unknown as SearchService,
      mockHealthIndicatorService as unknown as HealthIndicatorService,
    );
  });

  it('当 Meilisearch 在线时应报告 up 状态与版本号', async () => {
    mockSearchService.checkHealth.mockResolvedValue({
      status: 'up',
      driver: 'meilisearch',
      version: '1.12.0',
    });

    const result = await indicator.isHealthy('search');

    expect(mockHealthIndicatorService.check).toHaveBeenCalledWith('search');
    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      driver: 'meilisearch',
      version: '1.12.0',
    });
    expect(result.search.status).toBe('up');
  });

  it('当处于 Noop 驱动时应报告 up 状态及降级提示', async () => {
    mockSearchService.checkHealth.mockResolvedValue({
      status: 'up',
      driver: 'noop',
      message: 'NoopSearchDriver is active (Meilisearch is not configured)',
    });

    const result = await indicator.isHealthy('search');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      driver: 'noop',
      message: 'NoopSearchDriver is active (Meilisearch is not configured)',
    });
    expect(result.search.status).toBe('up');
  });

  it('当 Meilisearch 服务离线时应软依赖降级报告 degraded 状态', async () => {
    mockSearchService.checkHealth.mockResolvedValue({
      status: 'down',
      driver: 'meilisearch',
      message: 'connect ECONNREFUSED 127.0.0.1:7700',
    });

    const result = await indicator.isHealthy('search');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'meilisearch',
      message: 'connect ECONNREFUSED 127.0.0.1:7700',
    });
    expect(result.search.state).toBe('degraded');
  });

  it('当检查过程抛出未捕获异常时应安全捕获并上报 degraded 状态', async () => {
    mockSearchService.checkHealth.mockRejectedValue(new Error('Network error'));

    const result = await indicator.isHealthy('search');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      message: 'Network error',
    });
    expect(result.search.state).toBe('degraded');
  });
});

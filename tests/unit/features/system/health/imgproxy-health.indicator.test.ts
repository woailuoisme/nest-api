import type { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImgproxyService } from '@/common/media/imgproxy/imgproxy.service';
import { ImgproxyHealthIndicator } from '@/features/system/health/indicators/imgproxy-health.indicator';

describe('ImgproxyHealthIndicator', () => {
  let indicator: ImgproxyHealthIndicator;
  let mockImgproxyService: {
    isConfigured: ReturnType<typeof vi.fn>;
    getEndpoint: ReturnType<typeof vi.fn>;
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
      up: vi.fn().mockImplementation((data) => ({ imgproxy: { status: 'up', ...data } })),
      down: vi.fn().mockImplementation((data) => ({ imgproxy: { status: 'down', ...data } })),
    };

    mockHealthIndicatorService = {
      check: vi.fn().mockReturnValue(mockIndicatorBuilder),
    };

    mockImgproxyService = {
      isConfigured: vi.fn().mockReturnValue(true),
      getEndpoint: vi.fn().mockReturnValue('http://localhost:8080'),
    };

    indicator = new ImgproxyHealthIndicator(
      mockImgproxyService as unknown as ImgproxyService,
      mockHealthIndicatorService as unknown as HealthIndicatorService,
    );
  });

  it('未配置 imgproxy 时报告 disabled 状态且不阻塞存活', async () => {
    mockImgproxyService.isConfigured.mockReturnValue(false);

    const result = await indicator.isHealthy('imgproxy');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      driver: 'imgproxy',
      serviceStatus: 'disabled',
      message: expect.stringContaining('not configured'),
    });
    expect(result.imgproxy.status).toBe('up');
  });

  it('imgproxy /health 响应正常时报告 up 状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }),
    );

    const result = await indicator.isHealthy('imgproxy');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      driver: 'imgproxy',
      serviceStatus: 'up',
      endpoint: 'http://localhost:8080',
    });
    expect(result.imgproxy.status).toBe('up');

    vi.unstubAllGlobals();
  });

  it('imgproxy /health 响应非 200 时报告 degraded 软依赖降级状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await indicator.isHealthy('imgproxy');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'imgproxy',
      serviceStatus: 'down',
      message: 'imgproxy health check returned status 503',
    });

    vi.unstubAllGlobals();
  });

  it('网络异常或超时时优雅捕获并报告 degraded 降级状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    await indicator.isHealthy('imgproxy');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'imgproxy',
      serviceStatus: 'down',
      message: 'Connection refused',
    });

    vi.unstubAllGlobals();
  });
});

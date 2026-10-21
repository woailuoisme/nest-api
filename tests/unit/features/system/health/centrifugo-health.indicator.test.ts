import type { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CentrifugoHealthIndicator } from '@/features/system/health/indicators/centrifugo-health.indicator';
import type { RealtimeService } from '@/realtime';

describe('CentrifugoHealthIndicator 软依赖健康检查', () => {
  let indicator: CentrifugoHealthIndicator;
  let mockRealtimeService: {
    checkHealth: ReturnType<typeof vi.fn>;
    getDriver: ReturnType<typeof vi.fn>;
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
      up: vi.fn().mockImplementation((data) => ({ centrifugo: { status: 'up', ...data } })),
      down: vi.fn().mockImplementation((data) => ({ centrifugo: { status: 'down', ...data } })),
    };

    mockHealthIndicatorService = {
      check: vi.fn().mockReturnValue(mockIndicatorBuilder),
    };

    mockRealtimeService = {
      checkHealth: vi.fn(),
      getDriver: vi.fn().mockReturnValue('centrifugo'),
    };

    indicator = new CentrifugoHealthIndicator(
      mockRealtimeService as unknown as RealtimeService,
      mockHealthIndicatorService as unknown as HealthIndicatorService,
    );
  });

  it('当 Centrifugo 正常在线时应上报 up 状态及集群统计指标', async () => {
    mockRealtimeService.checkHealth.mockResolvedValue({
      status: 'up',
      nodesCount: 1,
      totalClients: 24,
      totalChannels: 8,
      version: '5.4.0',
    });

    const result = await indicator.isHealthy('centrifugo');

    expect(mockHealthIndicatorService.check).toHaveBeenCalledWith('centrifugo');
    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      driver: 'centrifugo',
      nodes: 1,
      clients: 24,
      channels: 8,
      version: '5.4.0',
    });
    expect(result.centrifugo.status).toBe('up');
  });

  it('当 Centrifugo 服务离线时应降级报告 degraded 状态 (软依赖容灾不触发 503)', async () => {
    mockRealtimeService.checkHealth.mockResolvedValue({
      status: 'down',
      nodesCount: 0,
      totalClients: 0,
      totalChannels: 0,
      error: 'connect ECONNREFUSED 127.0.0.1:8000',
    });

    const result = await indicator.isHealthy('centrifugo');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'centrifugo',
      message: 'connect ECONNREFUSED 127.0.0.1:8000',
    });
    expect(result.centrifugo.state).toBe('degraded');
  });

  it('当底层调用抛出未知异常时应安全降级报告 degraded', async () => {
    mockRealtimeService.checkHealth.mockRejectedValue(new Error('DNS resolution timeout'));

    const result = await indicator.isHealthy('centrifugo');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'centrifugo',
      message: 'DNS resolution timeout',
    });
    expect(result.centrifugo.state).toBe('degraded');
  });

  it('未配置 REALTIME_URL 时应报告 driver=none，不与「已配置但不可达」混淆', async () => {
    mockRealtimeService.getDriver.mockReturnValue('none');
    mockRealtimeService.checkHealth.mockResolvedValue({
      status: 'down',
      nodesCount: 0,
      totalClients: 0,
      totalChannels: 0,
      error: 'Centrifugo transport is not available',
    });

    const result = await indicator.isHealthy('centrifugo');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      driver: 'none',
      message: '未配置 REALTIME_URL：实时广播为空操作',
    });
    expect(result.centrifugo.state).toBe('degraded');
  });
});

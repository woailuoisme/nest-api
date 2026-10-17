import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it } from 'vitest';

import { ShutdownHealthIndicator } from '@/features/system/health/indicators/shutdown-health.indicator';
import { setAppShuttingDown } from '@/setup/lifecycle';

describe('ShutdownHealthIndicator', () => {
  let indicator: ShutdownHealthIndicator;

  beforeEach(() => {
    setAppShuttingDown(false);
    const healthIndicatorService = new HealthIndicatorService();
    indicator = new ShutdownHealthIndicator(healthIndicatorService);
  });

  it('正常运行时应返回 up 状态', () => {
    setAppShuttingDown(false);
    const result = indicator.isHealthy('shutdown');
    expect(result).toEqual({ shutdown: { status: 'up' } });
  });

  it('处于停机阶段时应返回 down 状态并附带提示信息', () => {
    setAppShuttingDown(true);
    const result = indicator.isHealthy('shutdown');
    expect(result).toEqual({
      shutdown: {
        status: 'down',
        message: '应用正在执行优雅停机下线',
      },
    });
  });
});

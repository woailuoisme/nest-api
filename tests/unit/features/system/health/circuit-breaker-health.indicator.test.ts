import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreakerStatus, CircuitBreakerStrategy } from '@/common/resilience/index.js';
import {
  CircuitBreakerHealthIndicator,
  type CircuitBreakerHealthStat,
} from '@/features/system/health/indicators/circuit-breaker-health.indicator.js';

describe('CircuitBreakerHealthIndicator (断路器健康检查指示器)', () => {
  let indicator: CircuitBreakerHealthIndicator;

  beforeEach(() => {
    vi.restoreAllMocks();
    const healthIndicatorService = new HealthIndicatorService();
    indicator = new CircuitBreakerHealthIndicator(healthIndicatorService);
  });

  it('场景 1: 无断路器或断路器全部处于 CLOSED 状态时，应返回 up 状态', () => {
    const stats: CircuitBreakerHealthStat[] = [
      {
        name: 'payment-service',
        status: CircuitBreakerStatus.Closed,
        stateName: 'Closed',
        failureRate: 0,
        totalCalls: 10,
      },
      {
        name: 'notification-service',
        status: CircuitBreakerStatus.Closed,
        stateName: 'Closed',
        failureRate: 0,
        totalCalls: 5,
      },
    ];
    vi.spyOn(CircuitBreakerStrategy, 'getStats').mockReturnValue(stats);

    const result = indicator.isHealthy('circuit_breakers');
    expect(result).toEqual({
      circuit_breakers: {
        status: 'up',
        totalCount: 2,
        breakers: stats,
      },
    });
  });

  it('场景 2: 存在处于 OPEN 状态的断路器时，应返回 down 状态并标明跳闸断路器', () => {
    const stats: CircuitBreakerHealthStat[] = [
      {
        name: 'payment-service',
        status: CircuitBreakerStatus.Closed,
        stateName: 'Closed',
        failureRate: 0,
        totalCalls: 10,
      },
      {
        name: 'shipping-service',
        status: CircuitBreakerStatus.Open,
        stateName: 'Open',
        failureRate: 80,
        totalCalls: 20,
      },
    ];
    vi.spyOn(CircuitBreakerStrategy, 'getStats').mockReturnValue(stats);

    const result = indicator.isHealthy('circuit_breakers');
    expect(result).toEqual({
      circuit_breakers: {
        status: 'down',
        openCount: 1,
        openBreakers: ['shipping-service'],
        breakers: stats,
      },
    });
  });

  it('场景 3: 支持自定义 indicator key', () => {
    vi.spyOn(CircuitBreakerStrategy, 'getStats').mockReturnValue([]);

    const result = indicator.isHealthy('custom_resilience');
    expect(result).toEqual({
      custom_resilience: {
        status: 'up',
        totalCount: 0,
        breakers: [],
      },
    });
  });
});

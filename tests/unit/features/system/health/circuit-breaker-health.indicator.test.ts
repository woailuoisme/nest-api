import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircuitBreakerService } from '@/common/resilience/circuit-breaker/circuit-breaker.service.js';
import type { CircuitBreakerStats } from '@/common/resilience/circuit-breaker/circuit-breaker.types.js';
import { CircuitBreakerHealthIndicator } from '@/features/system/health/indicators/circuit-breaker-health.indicator.js';

describe('CircuitBreakerHealthIndicator (断路器健康检查指示器)', () => {
  let indicator: CircuitBreakerHealthIndicator;
  let mockCircuitBreakerService: CircuitBreakerService;

  beforeEach(() => {
    mockCircuitBreakerService = {
      getStats: vi.fn().mockReturnValue([]),
    } as unknown as CircuitBreakerService;
    const healthIndicatorService = new HealthIndicatorService();
    indicator = new CircuitBreakerHealthIndicator(mockCircuitBreakerService, healthIndicatorService);
  });

  it('场景 1: 无断路器或断路器全部处于 CLOSED 状态时，应返回 up 状态', () => {
    const stats: CircuitBreakerStats[] = [
      { name: 'payment-service', state: 'CLOSED', rawState: 0 },
      { name: 'notification-service', state: 'CLOSED', rawState: 0 },
    ];
    vi.spyOn(mockCircuitBreakerService, 'getStats').mockReturnValue(stats);

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
    const stats: CircuitBreakerStats[] = [
      { name: 'payment-service', state: 'CLOSED', rawState: 0 },
      { name: 'shipping-service', state: 'OPEN', rawState: 1 },
    ];
    vi.spyOn(mockCircuitBreakerService, 'getStats').mockReturnValue(stats);

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

  it('场景 3: 存在处于 ISOLATED 状态的断路器时，应返回 down 状态', () => {
    const stats: CircuitBreakerStats[] = [{ name: 'isolated-service', state: 'ISOLATED', rawState: 3 }];
    vi.spyOn(mockCircuitBreakerService, 'getStats').mockReturnValue(stats);

    const result = indicator.isHealthy('circuit_breakers');
    expect(result).toEqual({
      circuit_breakers: {
        status: 'down',
        openCount: 1,
        openBreakers: ['isolated-service'],
        breakers: stats,
      },
    });
  });

  it('场景 4: 支持自定义 indicator key', () => {
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

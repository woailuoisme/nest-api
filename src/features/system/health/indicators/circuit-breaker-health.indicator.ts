import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { CircuitBreakerStatus, CircuitBreakerStrategy } from '@/common/resilience';

export type CircuitBreakerHealthStat = ReturnType<typeof CircuitBreakerStrategy.getStats>[number];

@Injectable()
export class CircuitBreakerHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isHealthy(key = 'circuit_breakers'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    const stats = CircuitBreakerStrategy.getStats();

    const openBreakers = stats.filter((s) => s.status === CircuitBreakerStatus.Open);

    if (openBreakers.length > 0) {
      return indicator.down({
        openCount: openBreakers.length,
        openBreakers: openBreakers.map((b) => b.name),
        breakers: stats,
      });
    }

    return indicator.up({
      totalCount: stats.length,
      breakers: stats,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { CircuitBreakerService, type CircuitBreakerStats } from '@/common/resilience';

@Injectable()
export class CircuitBreakerHealthIndicator {
  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy(key = 'circuit_breakers'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    const rawStats = this.circuitBreakerService.getStats();
    const stats = (Array.isArray(rawStats) ? rawStats : rawStats ? [rawStats] : []) as CircuitBreakerStats[];

    const openBreakers = stats.filter((s) => s.state === 'OPEN' || s.state === 'ISOLATED');

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

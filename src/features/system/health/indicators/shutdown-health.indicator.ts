import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { isAppShuttingDown } from '@/setup/lifecycle';

@Injectable()
export class ShutdownHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isHealthy(key = 'shutdown'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    if (isAppShuttingDown()) {
      return indicator.down({ message: '应用正在执行优雅停机下线' });
    }
    return indicator.up();
  }
}

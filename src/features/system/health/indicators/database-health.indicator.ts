import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import type { Database } from '@/database/drizzle/database';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        await this.db.execute('SELECT 1');
      })
      .withTimeout('1.5s');
  }
}

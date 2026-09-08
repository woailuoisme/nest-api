import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectDb() private readonly db: DrizzleDB,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.db.execute('SELECT 1');
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}

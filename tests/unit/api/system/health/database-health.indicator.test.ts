import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseHealthIndicator } from '@/api/system/health/indicators/database-health.indicator';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;
  let mockDb: DrizzleDB;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as DrizzleDB;
    const healthIndicatorService = new HealthIndicatorService();
    indicator = new DatabaseHealthIndicator(mockDb, healthIndicatorService);
  });

  it('should return up status when raw query succeeds', async () => {
    const result = await indicator.isHealthy('database');
    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('should return down status when database query fails', async () => {
    vi.spyOn(mockDb, 'execute').mockRejectedValue(new Error('Connection lost'));
    const result = await indicator.isHealthy('database');
    expect(result).toEqual({ database: { status: 'down', message: 'Connection lost' } });
  });
});

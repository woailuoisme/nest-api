import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/database/drizzle/database';
import { DatabaseHealthIndicator } from '@/features/system/health/indicators/database-health.indicator';

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;
  let mockDb: Database;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as Database;
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

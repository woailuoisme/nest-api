import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisHealthIndicator } from '@/api/system/health/indicators/redis-health.indicator';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockRedisClient: Redis;

  beforeEach(() => {
    mockRedisClient = {
      status: 'ready',
      connect: vi.fn(),
      ping: vi.fn().mockResolvedValue('PONG'),
    } as unknown as Redis;

    const healthIndicatorService = new HealthIndicatorService();
    indicator = new RedisHealthIndicator(mockRedisClient, healthIndicatorService);
  });

  it('should return up status when redis responds PONG', async () => {
    const result = await indicator.isHealthy('redis');
    expect(result).toEqual({ redis: { status: 'up' } });
  });

  it('should return down status when redis ping throws error', async () => {
    vi.spyOn(mockRedisClient, 'ping').mockRejectedValue(new Error('Connection timeout'));
    const result = await indicator.isHealthy('redis');
    expect(result).toEqual({ redis: { status: 'down', message: 'Connection timeout' } });
  });
});

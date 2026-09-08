import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthModule } from '@/features/system/health/health.module';
import { DatabaseHealthIndicator } from '@/features/system/health/indicators/database-health.indicator';
import { RedisHealthIndicator } from '@/features/system/health/indicators/redis-health.indicator';
import { StorageHealthIndicator } from '@/features/system/health/indicators/storage-health.indicator';

describe('HealthController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(DatabaseHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ database: { status: 'up' } }),
      })
      .overrideProvider(RedisHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'up' } }),
      })
      .overrideProvider(StorageHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ storage: { status: 'up', driver: 'local' } }),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/health (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('database');
    expect(body.info).toHaveProperty('redis');
    expect(body.info).toHaveProperty('storage');
  });

  it('/health/liveness (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/liveness',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('memory_heap');
    expect(body.info).toHaveProperty('memory_rss');
  });

  it('/health/readiness (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/readiness',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('database');
    expect(body.info).toHaveProperty('redis');
    expect(body.info).toHaveProperty('storage');
  });
});

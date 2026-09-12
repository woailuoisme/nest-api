import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthModule } from '@/features/system/health/health.module';
import { CentrifugoHealthIndicator } from '@/features/system/health/indicators/centrifugo-health.indicator';
import { CircuitBreakerHealthIndicator } from '@/features/system/health/indicators/circuit-breaker-health.indicator';
import { DatabaseHealthIndicator } from '@/features/system/health/indicators/database-health.indicator';
import { ImgproxyHealthIndicator } from '@/features/system/health/indicators/imgproxy-health.indicator';
import { MqttHealthIndicator } from '@/features/system/health/indicators/mqtt-health.indicator';
import { RedisHealthIndicator } from '@/features/system/health/indicators/redis-health.indicator';
import { SearchHealthIndicator } from '@/features/system/health/indicators/search-health.indicator';
import { StorageHealthIndicator } from '@/features/system/health/indicators/storage-health.indicator';
import { setAppShuttingDown } from '@/setup/lifecycle';

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
      .overrideProvider(CircuitBreakerHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockReturnValue({ circuit_breakers: { status: 'up', totalCount: 0, breakers: [] } }),
      })
      .overrideProvider(CentrifugoHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ centrifugo: { status: 'up', driver: 'centrifugo' } }),
      })
      .overrideProvider(SearchHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ search: { status: 'up', driver: 'noop' } }),
      })
      .overrideProvider(ImgproxyHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ imgproxy: { status: 'up', driver: 'imgproxy' } }),
      })
      .overrideProvider(MqttHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockResolvedValue({ mqtt: { status: 'up', connection: 'inactive' } }),
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
    expect(body.info).toHaveProperty('circuit_breakers');
    expect(body.info).toHaveProperty('centrifugo');
    expect(body.info).toHaveProperty('search');
    expect(body.info).toHaveProperty('imgproxy');
    expect(body.info).toHaveProperty('mqtt');
    expect(body.info).toHaveProperty('shutdown');
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
    expect(body.info).toHaveProperty('circuit_breakers');
    expect(body.info).toHaveProperty('centrifugo');
    expect(body.info).toHaveProperty('search');
    expect(body.info).toHaveProperty('imgproxy');
    expect(body.info).toHaveProperty('mqtt');
    expect(body.info).toHaveProperty('shutdown');
  });

  it('/health/readiness 在应用优雅停机期间应返回 503 Service Unavailable 并指示 shutdown down，而 liveness 保持 200', async () => {
    setAppShuttingDown(true);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health/readiness',
      });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('error');
      expect(body.error).toHaveProperty('shutdown');
      expect(body.error.shutdown.status).toBe('down');

      // 验证在停机期间 Liveness 依然保持健康 (200 OK)，防止 K8s 强杀 Pod
      const livenessResponse = await app.inject({
        method: 'GET',
        url: '/health/liveness',
      });
      expect(livenessResponse.statusCode).toBe(200);
    } finally {
      setAppShuttingDown(false);
    }
  });
});

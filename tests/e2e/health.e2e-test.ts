import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '@/app.module';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { CentrifugoHealthIndicator } from '@/features/system/health/indicators/centrifugo-health.indicator';
import { CircuitBreakerHealthIndicator } from '@/features/system/health/indicators/circuit-breaker-health.indicator';
import { DatabaseHealthIndicator } from '@/features/system/health/indicators/database-health.indicator';
import { ImgproxyHealthIndicator } from '@/features/system/health/indicators/imgproxy-health.indicator';
import { MiniprogramHealthIndicator } from '@/features/system/health/indicators/miniprogram-health.indicator';
import { MqttHealthIndicator } from '@/features/system/health/indicators/mqtt-health.indicator';
import { RedisHealthIndicator } from '@/features/system/health/indicators/redis-health.indicator';
import { SearchHealthIndicator } from '@/features/system/health/indicators/search-health.indicator';
import { StorageHealthIndicator } from '@/features/system/health/indicators/storage-health.indicator';
import { WepayHealthIndicator } from '@/features/system/health/indicators/wepay-health.indicator';
import { setAppShuttingDown } from '@/setup/lifecycle';

/** 探针桩：以固定的 up 结果替换真实探针，避免 e2e 依赖数据库 / Redis / MQTT 等外部组件 */
const stubIndicator = (health: Record<string, unknown>) => ({
  isHealthy: vi.fn().mockResolvedValue(health),
});

/** /health 与 /health/readiness 聚合结果中必须出现的全部探针键（与 HealthController.readinessIndicators 严格对齐） */
const AGGREGATED_INDICATORS = [
  'database',
  'redis',
  'storage',
  'circuit_breakers',
  'centrifugo',
  'search',
  'imgproxy',
  'mqtt',
  'wepay',
  'miniprogram',
  'shutdown',
] as const;

describe('HealthController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // 直接装配完整 AppModule：HealthModule 依赖 Media/Iot/Realtime 等领域模块的传递依赖
      // （EventEmitter、ConfigService 等），逐项装配易漂移且与生产图不一致。
      // 全部 10 个探针在下方被 overrideProvider 替换为桩，因此该用例不需要 Redis / DB / MQTT 在线
      // （Redis / MQTT 客户端均为惰性连接，不会在 app.init() 阶段建连）。
      imports: [AppModule],
    })
      .overrideProvider(DatabaseHealthIndicator)
      .useValue(stubIndicator({ database: { status: 'up' } }))
      .overrideProvider(RedisHealthIndicator)
      .useValue(stubIndicator({ redis: { status: 'up' } }))
      .overrideProvider(StorageHealthIndicator)
      .useValue(stubIndicator({ storage: { status: 'up', driver: 'local' } }))
      // CircuitBreakerHealthIndicator 为同步实现，保持 mockReturnValue 语义
      .overrideProvider(CircuitBreakerHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockReturnValue({ circuit_breakers: { status: 'up', totalCount: 0, breakers: [] } }),
      })
      .overrideProvider(CentrifugoHealthIndicator)
      .useValue(stubIndicator({ centrifugo: { status: 'up', driver: 'centrifugo' } }))
      .overrideProvider(SearchHealthIndicator)
      .useValue(stubIndicator({ search: { status: 'up', driver: 'noop' } }))
      .overrideProvider(ImgproxyHealthIndicator)
      .useValue(stubIndicator({ imgproxy: { status: 'up', driver: 'imgproxy' } }))
      .overrideProvider(MqttHealthIndicator)
      .useValue(stubIndicator({ mqtt: { status: 'up', connection: 'inactive' } }))
      .overrideProvider(WepayHealthIndicator)
      .useValue(stubIndicator({ wepay: { status: 'up', driver: 'mock' } }))
      .overrideProvider(MiniprogramHealthIndicator)
      .useValue(stubIndicator({ miniprogram: { status: 'up', driver: 'mock' } }))
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // 复刻 src/setup/middleware.ts 的全局异常过滤器：/health 的 503 响应形状由它决定，
    // 不挂过滤器只会验证框架原始载荷，测试将假绿（透出规则见 isHealthReportBody）
    app.useGlobalFilters(new HttpExceptionFilter(Boolean(moduleFixture.get(ConfigService).get('APP_DEBUG'))));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  /** 发起内联 GET 请求并解析 JSON 响应体 */
  async function getJson(url: string) {
    const response = await app.inject({ method: 'GET', url });
    return { statusCode: response.statusCode, body: JSON.parse(response.payload) };
  }

  /** 断言聚合结果包含全部探针键（/health 与 /health/readiness 契约一致） */
  function expectAllIndicators(info: Record<string, unknown>): void {
    for (const indicator of AGGREGATED_INDICATORS) {
      expect(info).toHaveProperty(indicator);
    }
  }

  it('/health (GET)', async () => {
    const { statusCode, body } = await getJson('/health');
    expect(statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expectAllIndicators(body.info);
  });

  it('/health/liveness (GET)', async () => {
    const { statusCode, body } = await getJson('/health/liveness');
    expect(statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info).toHaveProperty('memory_heap');
    expect(body.info).toHaveProperty('memory_rss');
  });

  it('/health/readiness (GET)', async () => {
    const { statusCode, body } = await getJson('/health/readiness');
    expect(statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expectAllIndicators(body.info);
  });

  it('/health/readiness 在应用优雅停机期间应返回 503 Service Unavailable 并指示 shutdown down，而 liveness 保持 200', async () => {
    setAppShuttingDown(true);
    try {
      const { statusCode, body } = await getJson('/health/readiness');
      expect(statusCode).toBe(503);
      expect(body.status).toBe('error');
      expect(body.error).toHaveProperty('shutdown');
      expect(body.error.shutdown.status).toBe('down');
      // 逐探针明细必须存活：K8s / 运维面板靠 info 与 error 桶定位「哪个探针 down」，
      // 全局异常过滤器不得把健康报告改写为统一错误信封
      expect(body.info).toHaveProperty('database');

      // 验证在停机期间 Liveness 依然保持健康 (200 OK)，防止 K8s 强杀 Pod
      const { statusCode: livenessStatus } = await getJson('/health/liveness');
      expect(livenessStatus).toBe(200);
    } finally {
      setAppShuttingDown(false);
    }
  });
});

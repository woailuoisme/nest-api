/**
 * 引导期 HTTP 契约 E2E — 装配完整 AppModule 并套用生产中间件链（`setupGlobalMiddleware`）。
 *
 * 覆盖 Nest 12 对齐改造后的对外可观察契约：
 * 1. 鉴权失败统一 401 信封；
 * 2. Standard Schema 校验失败的 422 信封（`VALIDATION_FAILED` + `fields` 字段级归集）；
 * 3. 内置 CSRF（Fetch Metadata）拒绝跨站写请求；
 * 4. 内置安全响应头生效且移除 `X-Powered-By`；
 * 5. 服务端调用（无 Origin / Sec-Fetch-Site）不被 CSRF 拦截。
 *
 * 不含数据库写入路径：鉴权相关用例仅断言拒绝分支，无需持久化依赖。
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '@/app.module';
import { setupGlobalMiddleware } from '@/setup/middleware';

describe('引导期 HTTP 契约 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    setupGlobalMiddleware(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('未携带凭证访问受保护路由 → 401 统一错误信封', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/admin/users' });
    const body = JSON.parse(response.payload) as { error: { code: string; message: string } };

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.error.message).toBe('string');
  });

  it('非法请求体 → 422 VALIDATION_FAILED 且按字段归集错误', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/iot/devices/token',
      headers: { 'content-type': 'application/json' },
      payload: { deviceId: 'bad id!', deviceSecret: 'x' },
    });
    const body = JSON.parse(response.payload) as {
      error: { code: string; message: string; fields: Record<string, string[]> };
    };

    expect(response.statusCode).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('Validation failed');
    expect(Object.keys(body.error.fields)).toEqual(expect.arrayContaining(['deviceId', 'deviceSecret']));
    expect(body.error.fields.deviceId.length).toBeGreaterThan(0);
  });

  it('跨站写请求 → 403（内置 CSRF 基于 Fetch Metadata 拒绝）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
        'sec-fetch-site': 'cross-site',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('服务端调用（无 Origin / Sec-Fetch-Site）不被 CSRF 拦截', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(response.statusCode).not.toBe(403);
  });

  it('默认移除 X-Powered-By', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

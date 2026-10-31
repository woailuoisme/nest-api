import { existsSync, readFileSync } from 'node:fs';

import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '@/app.module';
import { setupGlobalMiddleware } from '@/setup/middleware';

/**
 * 授权（@nestjs/authorization）401/403 矩阵：
 * - 认证先于授权：访客访问受保护路由 → 401
 * - 已登录但能力不足 → 403
 * - 本人资源 / 公共路由 → 放行
 *
 * 依赖已执行迁移的数据库（`just db-migrate`）；未迁移时整组跳过，避免污染本地库。
 */
const envFile = existsSync('.env') ? parse(readFileSync('.env')) : {};
const dbUrl = process.env.DB_URL ?? envFile.DB_URL ?? 'postgresql://postgres:postgres@localhost:5432/nest-api';
const authTablesReady = await (async () => {
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ table: string | null }>(
      "SELECT to_regclass('public.sessions')::text AS table",
    );
    return Boolean(rows[0]?.table);
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
})();

describe.skipIf(!authTablesReady)('Authorization guard (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    setupGlobalMiddleware(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const email = `authz-${Date.now()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email, password: 'password123' },
    });
    expect(signUp.statusCode).toBe(201);
    userId = JSON.parse(signUp.payload).id;
    const rawCookie = signUp.headers['set-cookie'];
    const first = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
    cookie = typeof first === 'string' ? first.split(';')[0] : '';
    expect(cookie).toBeTruthy();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('访客访问受保护路由 → 401（认证先于授权）', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('普通用户访问 /admin 管理面 → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('普通用户访问物联网设备面 → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/iot/devices', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('普通用户读取本人资料 → 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('普通用户读取他人资料 → 403（UserPolicy.view）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/00000000-0000-4000-8000-000000000000',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('公共路由（根路径）→ 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
  });
});

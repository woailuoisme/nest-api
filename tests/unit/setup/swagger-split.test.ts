import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { setupApiDocumentation } from '@/setup/swagger';

describe('Swagger & Scalar Split Integration Test', () => {
  it('verifies /docs (Client) and /docs/admin (Admin) are completely isolated in both JSON and HTML', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    setupApiDocumentation(app, 'http://localhost:4300');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 1. 客户端 OpenAPI JSON Spec 校验
    const clientJsonRes = await app.inject({ method: 'GET', url: '/docs-json' });
    expect(clientJsonRes.statusCode).toBe(200);
    const clientJson = JSON.parse(clientJsonRes.body);
    expect(clientJson.info.title).toBe('NestForge Client API');
    expect(clientJson.tags.map((t: { name: string }) => t.name)).toEqual(['认证', '用户中心']);
    expect(Object.keys(clientJson.paths)).toContain('/auth/login');
    expect(Object.keys(clientJson.paths)).toContain('/users/me');
    expect(Object.keys(clientJson.paths)).not.toContain('/admin/admins');
    expect(Object.keys(clientJson.paths)).not.toContain('/admin/users');

    // 2. 管理后台 OpenAPI JSON Spec 校验
    const adminJsonRes = await app.inject({ method: 'GET', url: '/docs-admin-json' });
    expect(adminJsonRes.statusCode).toBe(200);
    const adminJson = JSON.parse(adminJsonRes.body);
    expect(adminJson.info.title).toBe('NestForge Admin API');
    expect(adminJson.tags.map((t: { name: string }) => t.name)).toEqual([
      '认证管理',
      '管理员管理',
      '用户管理',
      '仪表盘',
      '消息通知',
    ]);
    expect(Object.keys(adminJson.paths)).toContain('/admin/admins');
    expect(Object.keys(adminJson.paths)).toContain('/admin/auth/login');
    expect(Object.keys(adminJson.paths)).toContain('/admin/users');
    expect(Object.keys(adminJson.paths)).not.toContain('/auth/register');
    expect(Object.keys(adminJson.paths)).not.toContain('/users/me');

    // 3. 客户端 Scalar HTML 校验
    const clientHtmlRes = await app.inject({ method: 'GET', url: '/docs' });
    expect(clientHtmlRes.statusCode).toBe(200);
    expect(clientHtmlRes.headers['content-type']).toContain('text/html');
    expect(clientHtmlRes.body).toContain('NestForge Client API');
    expect(clientHtmlRes.body).not.toContain('NestForge Admin API');

    // 4. 管理后台 Scalar HTML 校验 (绝不被 /docs 前缀拦截)
    const adminHtmlRes = await app.inject({ method: 'GET', url: '/docs/admin' });
    expect(adminHtmlRes.statusCode).toBe(200);
    expect(adminHtmlRes.headers['content-type']).toContain('text/html');
    expect(adminHtmlRes.body).toContain('NestForge Admin API');
    expect(adminHtmlRes.body).not.toContain('NestForge Client API');

    await app.close();
  });
});

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
    await setupApiDocumentation(app, 'http://localhost:4300');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 1. 客户端 OpenAPI JSON Spec 校验 (仅保留纯客户端业务端点，Better Auth 端点已剥离至 /docs/auth，Admin 端点严格隔离)
    const clientJsonRes = await app.inject({ method: 'GET', url: '/docs-json' });
    expect(clientJsonRes.statusCode).toBe(200);
    const clientJson = JSON.parse(clientJsonRes.body);
    expect(clientJson.info.title).toBe('NestForge Client API');
    expect(clientJson.info.description).toContain('/docs/auth');
    expect(clientJson.tags.map((t: { name: string }) => t.name)).toEqual(['用户中心']);
    expect(Object.keys(clientJson.paths)).not.toContain('/auth/{path}');
    expect(Object.keys(clientJson.paths)).not.toContain('/v1/auth/sign-in/email');
    expect(Object.keys(clientJson.paths)).not.toContain('/v1/auth/sign-up/email');
    expect(Object.keys(clientJson.paths)).toContain('/users/me');
    expect(Object.keys(clientJson.paths)).not.toContain('/admin/users');
    expect(Object.keys(clientJson.paths)).not.toContain('/admin/dashboard/metrics');
    expect(Object.keys(clientJson.paths)).not.toContain('/v1/auth/admin/list-users');
    expect(clientJson.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(clientJson.components.securitySchemes).toHaveProperty('cookieAuth');

    // 2. 管理后台 OpenAPI JSON Spec 校验 (仅保留纯管理端业务端点，Better Auth 端点已剥离至 /docs/auth，前台端点严格隔离)
    const adminJsonRes = await app.inject({ method: 'GET', url: '/docs-admin-json' });
    expect(adminJsonRes.statusCode).toBe(200);
    const adminJson = JSON.parse(adminJsonRes.body);
    expect(adminJson.info.title).toBe('NestForge Admin API');
    expect(adminJson.info.description).toContain('/docs/auth');
    expect(adminJson.tags.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['用户管理', '仪表盘', '消息通知']),
    );
    expect(adminJson.tags.map((t: { name: string }) => t.name)).not.toContain('认证-管理员治理');
    expect(Object.keys(adminJson.paths)).toContain('/admin/users');
    expect(Object.keys(adminJson.paths)).toContain('/admin/dashboard/metrics');
    expect(Object.keys(adminJson.paths)).toContain('/admin/notifications/send');
    expect(Object.keys(adminJson.paths)).not.toContain('/v1/auth/admin/list-users');
    expect(Object.keys(adminJson.paths)).not.toContain('/auth/{path}');
    expect(Object.keys(adminJson.paths)).not.toContain('/users/me');
    expect(Object.keys(adminJson.paths)).not.toContain('/v1/auth/sign-in/email');
    expect(adminJson.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(adminJson.components.securitySchemes).toHaveProperty('cookieAuth');

    // 3. Better Auth 全量专本文档 JSON Spec 校验 (全量 118 个端点完整聚合)
    const authJsonRes = await app.inject({ method: 'GET', url: '/docs-auth-json' });
    expect(authJsonRes.statusCode).toBe(200);
    const authJson = JSON.parse(authJsonRes.body);
    expect(authJson.info.title).toBe('NestForge Better Auth API Reference');
    expect(authJson.tags.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining([
        '认证-核心凭据',
        '认证-双因素(2FA)',
        '认证-组织租户',
        '认证-管理员治理',
        '认证-通行密钥',
        '认证-一键登录',
        '认证-匿名访客',
      ]),
    );
    expect(Object.keys(authJson.paths)).toContain('/v1/auth/sign-in/email');
    expect(Object.keys(authJson.paths)).toContain('/v1/auth/admin/list-users');
    expect(Object.keys(authJson.paths)).toContain('/v1/auth/passkey/generate-register-options');
    expect(Object.keys(authJson.paths)).toContain('/v1/auth/one-tap/callback');
    expect(Object.keys(authJson.paths)).toContain('/v1/auth/sign-in/anonymous');
    expect(Object.keys(authJson.paths).length).toBe(132);
    expect(authJson.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(authJson.components.securitySchemes).toHaveProperty('cookieAuth');

    // 4. 客户端 Scalar HTML 校验 (包含统一配置)
    const clientHtmlRes = await app.inject({ method: 'GET', url: '/docs' });
    expect(clientHtmlRes.statusCode).toBe(200);
    expect(clientHtmlRes.headers['content-type']).toContain('text/html');
    expect(clientHtmlRes.body).toContain('NestForge Client API');
    expect(clientHtmlRes.body).not.toContain('NestForge Admin API');
    expect(clientHtmlRes.body).toContain('"persistAuth": true');
    expect(clientHtmlRes.body).toContain('"telemetry": false');
    expect(clientHtmlRes.body).toContain('"theme": "purple"');
    expect(clientHtmlRes.body).toContain('"orderRequiredPropertiesFirst": true');
    expect(clientHtmlRes.body).toContain('"orderSchemaPropertiesBy": "preserve"');

    // 5. 管理后台 Scalar HTML 校验 (绝不被 /docs 前缀拦截，包含统一配置)
    const adminHtmlRes = await app.inject({ method: 'GET', url: '/docs/admin' });
    expect(adminHtmlRes.statusCode).toBe(200);
    expect(adminHtmlRes.headers['content-type']).toContain('text/html');
    expect(adminHtmlRes.body).toContain('NestForge Admin API');
    expect(adminHtmlRes.body).not.toContain('NestForge Client API');
    expect(adminHtmlRes.body).toContain('"persistAuth": true');
    expect(adminHtmlRes.body).toContain('"telemetry": false');
    expect(adminHtmlRes.body).toContain('"theme": "purple"');
    expect(adminHtmlRes.body).toContain('"orderRequiredPropertiesFirst": true');
    expect(adminHtmlRes.body).toContain('"orderSchemaPropertiesBy": "preserve"');

    // 6. Better Auth 专本文档 Scalar HTML 校验 (包含统一配置)
    const authHtmlRes = await app.inject({ method: 'GET', url: '/docs/auth' });
    expect(authHtmlRes.statusCode).toBe(200);
    expect(authHtmlRes.headers['content-type']).toContain('text/html');
    expect(authHtmlRes.body).toContain('NestForge Better Auth API Reference');
    expect(authHtmlRes.body).toContain('"persistAuth": true');
    expect(authHtmlRes.body).toContain('"telemetry": false');
    expect(authHtmlRes.body).toContain('"theme": "purple"');
    expect(authHtmlRes.body).toContain('"orderRequiredPropertiesFirst": true');
    expect(authHtmlRes.body).toContain('"orderSchemaPropertiesBy": "preserve"');

    await app.close();
  });
});

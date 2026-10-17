import { describe, expect, it } from 'vitest';

import {
  BETTER_AUTH_SECURITY_SCHEMES,
  BETTER_AUTH_TAG_MAP,
  clearBetterAuthOpenAPICache,
  getProcessedBetterAuthOpenAPI,
} from '@/setup/swagger/better-auth-openapi';

describe('Better Auth OpenAPI Processor', () => {
  it('应完整包含 17 个插件与特性的中文标签元数据定义', () => {
    const requiredKeys = [
      'Default',
      'Two-factor',
      'Username',
      'Phone-number',
      'Magic-link',
      'Email-otp',
      'Api-key',
      'Organization',
      'Multi-session',
      'Jwt',
      'Device-authorization',
      'Passkey',
      'One-tap',
      'Anonymous',
      'One-time-token',
      'Sso',
      'Admin',
    ];
    for (const key of requiredKeys) {
      expect(BETTER_AUTH_TAG_MAP[key]).toBeDefined();
      expect(BETTER_AUTH_TAG_MAP[key].name).toMatch(/^认证-/);
      expect(BETTER_AUTH_TAG_MAP[key].description).toBeTruthy();
    }
  });

  it('应定义 bearerAuth 与 cookieAuth 双模态认证方案', () => {
    expect(BETTER_AUTH_SECURITY_SCHEMES.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(BETTER_AUTH_SECURITY_SCHEMES.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'better-auth.session_token',
    });
  });

  it('应正确转换端点路径前缀、映射中文标签、拆分权限边界并注入双模态凭据', async () => {
    clearBetterAuthOpenAPICache();
    const processed = await getProcessedBetterAuthOpenAPI();

    // 1. 端点总数与前后台拆分（17 个特性标签共 132 个端点：管理端 15 个，客户端 117 个）
    const allPathsCount = Object.keys(processed.allPaths).length;
    const clientPathsCount = Object.keys(processed.clientPaths).length;
    const adminPathsCount = Object.keys(processed.adminPaths).length;

    expect(allPathsCount).toBe(132);
    expect(adminPathsCount).toBe(15);
    expect(clientPathsCount).toBe(117);
    expect(clientPathsCount + adminPathsCount).toBe(allPathsCount);

    // 2. 绝对路径前缀验证 (/v1/auth)
    for (const p of Object.keys(processed.allPaths)) {
      expect(p.startsWith('/v1/auth/')).toBe(true);
    }

    // 3. 客户端与管理端端点隔离验证
    expect(Object.keys(processed.clientPaths)).toContain('/v1/auth/sign-in/email');
    expect(Object.keys(processed.clientPaths)).toContain('/v1/auth/sign-up/email');
    expect(Object.keys(processed.clientPaths)).toContain('/v1/auth/passkey/generate-register-options');
    expect(Object.keys(processed.clientPaths)).toContain('/v1/auth/one-tap/callback');
    expect(Object.keys(processed.clientPaths)).toContain('/v1/auth/sign-in/anonymous');
    expect(Object.keys(processed.clientPaths)).not.toContain('/v1/auth/admin/list-users');

    expect(Object.keys(processed.adminPaths)).toContain('/v1/auth/admin/list-users');
    expect(Object.keys(processed.adminPaths)).toContain('/v1/auth/admin/ban-user');
    expect(Object.keys(processed.adminPaths)).not.toContain('/v1/auth/sign-in/email');

    // 4. 双模态凭据注入与中文标签转换
    const sampleOp = (processed.allPaths['/v1/auth/sign-in/email'] as Record<string, any>).post;
    expect(sampleOp.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(sampleOp.tags).toContain('认证-核心凭据');

    const passkeyOp = (processed.allPaths['/v1/auth/passkey/generate-register-options'] as Record<string, any>).get;
    expect(passkeyOp.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(passkeyOp.tags).toContain('认证-通行密钥');

    const oneTapOp = (processed.allPaths['/v1/auth/one-tap/callback'] as Record<string, any>).post;
    expect(oneTapOp.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(oneTapOp.tags).toContain('认证-一键登录');

    const anonOp = (processed.allPaths['/v1/auth/sign-in/anonymous'] as Record<string, any>).post;
    expect(anonOp.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(anonOp.tags).toContain('认证-匿名访客');

    const adminOp = (processed.allPaths['/v1/auth/admin/list-users'] as Record<string, any>).get;
    expect(adminOp.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(adminOp.tags).toContain('认证-管理员治理');

    // 5. 标签集合与 Schemas
    expect(processed.allTags.map((t) => t.name)).toContain('认证-核心凭据');
    expect(processed.allTags.map((t) => t.name)).toContain('认证-通行密钥');
    expect(processed.allTags.map((t) => t.name)).toContain('认证-一键登录');
    expect(processed.allTags.map((t) => t.name)).toContain('认证-匿名访客');
    expect(processed.allTags.map((t) => t.name)).toContain('认证-管理员治理');
    expect(processed.schemas).toBeDefined();
    expect(Object.keys(processed.schemas).length).toBeGreaterThan(0);
  });

  it('多度调用应命中单例缓存', async () => {
    clearBetterAuthOpenAPICache();
    const first = await getProcessedBetterAuthOpenAPI();
    const second = await getProcessedBetterAuthOpenAPI();
    expect(first).toBe(second);
  });
});

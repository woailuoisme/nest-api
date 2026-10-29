import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '@/app.module';
import { setupGlobalMiddleware } from '@/setup/middleware';

/**
 * 官方 @nestjs/i18n 端到端契约：
 * - ?lang / x-lang 优先于 Accept-Language；默认 zh
 * - 校验消息随请求语言本地化，并返回 Content-Language
 */
describe('Internationalization (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    setupGlobalMiddleware(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const signUp = (url: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      payload: { email: 'not-an-email', password: 'short' },
    });

  it('?lang=en：英文校验消息与 Content-Language', async () => {
    const res = await signUp('/v1/auth/sign-up?lang=en');
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-language']).toBe('en');

    const body = JSON.parse(res.payload);
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.fields.email.join(' ')).toContain('must be a valid email address');
    expect(body.error.fields.password.join(' ')).toContain('must be at least 8 characters');
  });

  it('x-lang 优先于 Accept-Language', async () => {
    const res = await signUp('/v1/auth/sign-up', {
      'x-lang': 'zh',
      'accept-language': 'en-US,en;q=0.9',
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-language']).toBe('zh');

    const body = JSON.parse(res.payload);
    expect(body.error.message).toBe('参数校验失败');
    expect(body.error.fields.email.join(' ')).toContain('不是有效的邮箱地址');
  });

  it('Accept-Language 解析（en）', async () => {
    const res = await signUp('/v1/auth/sign-up', { 'accept-language': 'en-US,en;q=0.9' });
    expect(res.headers['content-language']).toBe('en');
    expect(JSON.parse(res.payload).error.message).toBe('Validation failed');
  });

  it('未指定语言时默认 zh', async () => {
    const res = await signUp('/v1/auth/sign-up');
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-language']).toBe('zh');
    expect(JSON.parse(res.payload).error.message).toBe('参数校验失败');
  });
});

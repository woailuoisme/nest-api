/**
 * 校验与序列化契约 E2E — Nest 12 原生 Standard Schema 通道的真实 HTTP 行为。
 *
 * 覆盖（与 docs/api.md「校验契约细则」逐条对应）：
 * 1. 422 信封形状稳定（`{ error: { code: 'VALIDATION_FAILED', fields } }`）；
 * 2. `z.object` 静默剥离未知字段 vs `z.strictObject` 拒绝未知字段；
 * 3. 响应 schema 即白名单（敏感字段不外泄）；
 * 4. 自定义参数装饰器携带 `schema` 时会被校验（`validateCustomDecorators: true`）。
 *
 * 隔离：不依赖数据库/Redis，控制器与全局管道/过滤器均在本文件内装配。
 */
import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  Post,
  SerializeOptions,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { createApiValidationPipe } from '@/setup/middleware';

/** 新增写接口的推荐形态：strictObject → 未声明字段直接 422 */
const CreateThingSchema = z.strictObject({
  name: z.string().trim().min(2),
  qty: z.coerce.number().int().min(1),
});

/** 存量写接口形态：z.object → 未声明字段静默丢弃 */
const LooseSchema = z.object({
  name: z.string().trim().min(2),
});

/** 响应白名单：未声明字段不会出现在响应体里 */
const ThingResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** 自定义装饰器：从请求头读取租户标识，并声明 schema 供管道校验 */
const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers['x-tenant-id'],
);

@Controller('test-validation')
class ValidationTestController {
  @Post('strict')
  strict(@Body({ schema: CreateThingSchema }) dto: z.infer<typeof CreateThingSchema>) {
    return { ok: true, dto };
  }

  @Post('loose')
  loose(@Body({ schema: LooseSchema }) dto: z.infer<typeof LooseSchema>) {
    return { ok: true, received: dto };
  }

  @Get('serialized')
  @SerializeOptions({ schema: ThingResponseSchema })
  serialized() {
    // 故意返回敏感/内部字段，验证序列化白名单会裁掉
    return { id: 'thing-1', name: 'visible', secret: 'leak-me', internalFlag: true };
  }

  @Post('tenant')
  tenant(@TenantId({ schema: z.uuid() }) tenantId: string) {
    return { ok: true, tenantId };
  }
}

describe('校验与序列化契约 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ValidationTestController],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // 与生产一致的三件套：统一校验管道 + 统一异常过滤器 + schema 序列化拦截器
    app.useGlobalPipes(createApiValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter(false));
    app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('strictObject 下未知字段触发 422，且信封四键与 code 稳定', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test-validation/strict',
      payload: { name: 'Widget', qty: 2, isAdmin: true },
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.payload) as {
      error?: { code?: string; message?: string; fields?: Record<string, string[]> };
    };
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.message).toBe('Validation failed');
    expect(body.error?.fields).toBeTypeOf('object');
    // strictObject 的未知字段错误没有路径，归入 root
    expect(JSON.stringify(body.error?.fields)).toContain('Unrecognized key');
  });

  it('z.object 下未知字段被剥离，handler 收到干净载荷', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test-validation/loose',
      payload: { name: '  Widget  ', isAdmin: true },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toEqual({ ok: true, received: { name: 'Widget' } });
  });

  it('响应 schema 即白名单：未声明字段不外泄', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-validation/serialized' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ id: 'thing-1', name: 'visible' });
    expect(response.payload).not.toContain('leak-me');
  });

  it('自定义装饰器携带 schema 时被校验（validateCustomDecorators 已开启）', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/test-validation/tenant',
      headers: { 'x-tenant-id': 'not-a-uuid' },
    });
    expect(invalid.statusCode).toBe(422);

    const valid = await app.inject({
      method: 'POST',
      url: '/test-validation/tenant',
      headers: { 'x-tenant-id': '01931234-0000-7000-8000-000000000042' },
    });
    expect(valid.statusCode).toBe(201);
    expect(JSON.parse(valid.payload)).toEqual({ ok: true, tenantId: '01931234-0000-7000-8000-000000000042' });
  });
});

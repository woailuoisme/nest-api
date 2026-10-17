import { Controller, Get, Module, SerializeOptions, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PageMetaResource, PaginatedResultResource, paginatedEnvelopeSchema } from '@/common/dto/pagination.dto';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';

const ItemSchema = z.object({ id: z.string(), name: z.string() });
const PageSchema = paginatedEnvelopeSchema(ItemSchema);

/**
 * 探针控制器：返回带有「未在输出契约中声明字段」的载荷，用于验证白名单裁剪。
 * 拦截器注册顺序与 src/setup/middleware.ts 保持一致（序列化器位于 TransformInterceptor 之前）。
 */
@Controller('probe')
class ProbeController {
  @Get('single')
  @SerializeOptions({ schema: ItemSchema })
  single() {
    return { id: 'u1', name: '张三', passwordHash: 'leaked-hash' };
  }

  @Get('list')
  @SerializeOptions({ schema: PageSchema })
  list() {
    return new PaginatedResultResource(
      [{ id: 'u1', name: '张三', passwordHash: 'leaked-hash' }],
      new PageMetaResource({ page: 1, pageSize: 20 }, 1),
    );
  }

  @Get('unregistered')
  unregistered() {
    return { id: 'u1', name: '张三', passwordHash: 'leaked-hash' };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new TransformInterceptor(reflector),
      inject: [Reflector],
    },
  ],
})
class ProbeModule {}

describe('StandardSchemaSerializerInterceptor（响应白名单裁剪）', () => {
  /** 启动一个与生产注册顺序一致的探针应用 */
  async function createProbeApp(): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  it('单资源响应：按资源 schema 裁剪未声明字段', async () => {
    const app = await createProbeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/probe/single' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: 'u1', name: '张三' });
    } finally {
      await app.close();
    }
  });

  it('分页响应：信封结构不变且 items 逐项裁剪', async () => {
    const app = await createProbeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/probe/list' });
      const body = res.json() as { items: Record<string, unknown>[]; meta: Record<string, unknown> };

      expect(res.statusCode).toBe(200);
      expect(body.items).toEqual([{ id: 'u1', name: '张三' }]);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
      // 兼容别名 pagination 不应出现在最终响应中
      expect(body).not.toHaveProperty('pagination');
    } finally {
      await app.close();
    }
  });

  it('未声明 @SerializeOptions 的端点零干预透传', async () => {
    const app = await createProbeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/probe/unregistered' });

      expect(res.json()).toEqual({ id: 'u1', name: '张三', passwordHash: 'leaked-hash' });
    } finally {
      await app.close();
    }
  });
});

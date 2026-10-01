import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodStandardSchemaConverter } from '@/setup/swagger/standard-schema-converter';

/** 以 Zod schema 调用转换器并取回 JSON Schema 属性表（非 Zod 入参场景由专门用例覆盖） */
function convert(schema: z.ZodType): Record<string, unknown> {
  const result = zodStandardSchemaConverter(schema, { schemaType: 'output' } as never);
  expect(result).toBeDefined();
  const jsonSchema = result!.schema as { properties: Record<string, unknown> };
  return jsonSchema.properties;
}

describe('zodStandardSchemaConverter', () => {
  it('z.date() 应落为 string/date-time（否则会中断整份文档生成）', () => {
    const properties = convert(z.object({ createdAt: z.date(), name: z.string() }));

    expect(properties.createdAt).toEqual({ type: 'string', format: 'date-time' });
    expect(properties.name).toEqual({ type: 'string' });
  });

  it('z.bigint() 应落为 string', () => {
    const properties = convert(z.object({ size: z.bigint() }));

    expect(properties.size).toEqual({ type: 'string' });
  });

  it('嵌套与可空时间字段同样应保持可表达（回归防护：instanceof 判定不依赖类名）', () => {
    const properties = convert(
      z.object({
        items: z.array(z.object({ deletedAt: z.date().nullable() })),
      }),
    );

    const items = properties.items as { items: { properties: Record<string, unknown> } };
    // 可空时间在 OpenAPI 3.0 目标下表达为 nullable: true（而非 3.1 的 anyOf/type: null）
    expect(items.items.properties.deletedAt).toEqual({ type: 'string', format: 'date-time', nullable: true });
  });

  it('非 Zod schema 应交回框架默认实现（返回 undefined）', () => {
    expect(zodStandardSchemaConverter({ '~standard': {} } as never, { schemaType: 'output' } as never)).toBeUndefined();
  });
});

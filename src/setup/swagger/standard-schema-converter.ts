import type { StandardSchemaConverter } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * 修正 Zod 无法在 JSON Schema 中表达的类型。
 *
 * Zod 默认对 `z.date()` 抛 "Date cannot be represented in JSON Schema"，
 * 而契约中的时间字段在线路上本就是 ISO 8601 字符串，故显式落为 `string/date-time`。
 *
 * 用 `instanceof` 而非 `constructor.name` 字符串查表：构建期压缩或依赖升级改写类名时，
 * 字符串查表会静默降级为 `'any'`（文档出现空 schema），类型判定则始终可靠。
 */
function toRepresentableJsonSchema(zodSchema: unknown): Record<string, unknown> | 'any' {
  if (zodSchema instanceof z.ZodDate) {
    return { type: 'string', format: 'date-time' };
  }
  if (zodSchema instanceof z.ZodBigInt) {
    return { type: 'string' };
  }
  return 'any';
}

/**
 * 自定义 Standard Schema → OpenAPI 转换器（仅接管 Zod schema，其余类型交由框架默认实现）。
 *
 * Nest 12 默认转换器直接调用 `schema['~standard'].jsonSchema`，遇到日期等不可表达类型会中断文档生成；
 * 此处改走 Zod 的 `toJSONSchema`，以 `unrepresentable` 钩子补齐映射，保证请求体与响应文档始终可生成。
 */
export const zodStandardSchemaConverter: StandardSchemaConverter = (schema, { schemaType }) => {
  if (!(schema instanceof z.ZodType)) {
    return undefined;
  }

  return {
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: schemaType,
      unrepresentable: ({ zodSchema }) => toRepresentableJsonSchema(zodSchema),
    }),
  };
};

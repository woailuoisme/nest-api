/**
 * 字符串工具函数 — 基于 case-anything 算法的命名转换、pluralize 复数化、
 * 以及 Swagger 装饰器构建。
 * 纯函数，不依赖外部状态，便于单独测试。
 */

import { camelCase, pascalCase, snakeCase } from 'es-toolkit/string';
import pluralizeLib from 'pluralize';

/** camelCase → snake_case */
export function toSnakeCase(str: string): string {
  return snakeCase(str);
}

/** 任意字符串 → camelCase（firstWord + CapitalizedRest） */
export function toCamelCase(str: string): string {
  return camelCase(str);
}

/** 任意字符串 → PascalCase */
export function toPascalCase(str: string): string {
  return pascalCase(str);
}

/** 标准复数化（person → people, category → categories 等） */
export function pluralize(str: string): string {
  return pluralizeLib(str);
}

/** 转义单引号与反斜杠，保证生成的 TS 字符串字面量合法 */
export function escapeTsString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 构建 @ApiProperty / @ApiPropertyOptional 装饰器字符串（多行格式，避免 oxfmt line-width） */
export function buildApiProperty(name: string, description: string, tsType: string, isOptional: boolean): string {
  const decorator = isOptional ? '@ApiPropertyOptional' : '@ApiProperty';
  const nullable = isOptional ? '\n    nullable: true,' : '';
  const safeDesc = escapeTsString(description);
  return `${decorator}({\n    example: ${getSwaggerExample(name, tsType)},\n    description: '${safeDesc}',${nullable}\n  })`;
}

/** 根据字段名和类型生成 Swagger example 值 */
function getSwaggerExample(name: string, tsType: string): string {
  const examples: Record<string, string> = {
    email: "'user@example.com'",
    name: "'示例名称'",
    title: "'示例标题'",
  };
  if (examples[name]) return examples[name];

  const typeDefaults: Record<string, string> = {
    string: "'example'",
    number: '1',
    boolean: 'false',
    Date: "'2024-01-15T10:30:00.000Z'",
  };
  return typeDefaults[tsType] ?? "'example'";
}

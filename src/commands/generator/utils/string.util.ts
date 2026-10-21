/**
 * 命名转换工具 — 大小写转换、复数化与 TS 字符串转义。
 *
 * 纯函数、无外部状态、无 I/O，可独立单测。
 * Swagger 装饰器代码生成不在此文件（见 `../swagger.snippet.ts`）：那是模板产物契约，不是字符串工具。
 */

import { camelCase, pascalCase, snakeCase } from 'es-toolkit/string';
import pluralizeLib from 'pluralize';

/** camelCase → snake_case */
export function toSnakeCase(str: string): string {
  return snakeCase(str);
}

/** Any string -> camelCase (firstWord + CapitalizedRest) */
export function toCamelCase(str: string): string {
  return camelCase(str);
}

/** Any string -> PascalCase */
export function toPascalCase(str: string): string {
  return pascalCase(str);
}

/** Standard pluralization (person -> people, category -> categories, etc.) */
export function pluralize(str: string): string {
  return pluralizeLib(str);
}

/** Escape single quotes and backslashes so the generated TS string literal stays valid */
export function escapeTsString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

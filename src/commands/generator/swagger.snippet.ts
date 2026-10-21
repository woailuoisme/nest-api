/**
 * Swagger 装饰器代码片段生成 — CRUD 模板专用。
 *
 * 这里产出的是**生成的 TS 源码片段**（模板契约的一部分），与纯字符串工具分开维护：
 * 调整注释/换行会直接改变生成物，需配合模板测试。
 */

import { escapeTsString } from './utils/string.util';

/** Build @ApiProperty / @ApiPropertyOptional decorator strings (multi-line to stay within oxfmt line-width) */
export function buildApiProperty(name: string, description: string, tsType: string, isOptional: boolean): string {
  const decorator = isOptional ? '@ApiPropertyOptional' : '@ApiProperty';
  const nullable = isOptional ? '\n    nullable: true,' : '';
  const safeDesc = escapeTsString(description);
  return `${decorator}({\n    example: ${getSwaggerExample(name, tsType)},\n    description: '${safeDesc}',${nullable}\n  })`;
}

/** Generate a Swagger example value from the field name and type */
function getSwaggerExample(name: string, tsType: string): string {
  const examples: Record<string, string> = {
    email: "'user@example.com'",
    name: "'Example name'",
    title: "'Example title'",
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

/**
 * Swagger 装饰器片段生成契约测试
 *
 * 这些字符串会直接写进生成物源码，样例值与 nullable 语义一旦漂移，
 * 生成的项目就会带上错误的 OpenAPI 文档或类型，因此单独锁定。
 */
import { describe, expect, it } from 'vitest';

import { buildApiProperty } from '@/commands/generator/swagger.snippet';

describe('swagger.snippet（模板代码生成契约）', () => {
  it('必填字段使用 @ApiProperty，且按字段名给出语义化示例', () => {
    const snippet = buildApiProperty('email', 'user email', 'string', false);

    expect(snippet).toContain('@ApiProperty({');
    expect(snippet).not.toContain('@ApiPropertyOptional');
    expect(snippet).toContain("example: 'user@example.com'");
    expect(snippet).not.toContain('nullable');
  });

  it('可选字段使用 @ApiPropertyOptional 并显式标注 nullable', () => {
    const snippet = buildApiProperty('age', 'user age', 'number', true);

    expect(snippet).toContain('@ApiPropertyOptional({');
    expect(snippet).toContain('example: 1');
    expect(snippet).toContain('nullable: true,');
  });

  it('描述中的单引号必须转义，避免生成物语法错误', () => {
    const snippet = buildApiProperty('name', "user's name", 'string', false);

    expect(snippet).toContain("description: 'user\\'s name'");
  });

  it('未知字段名与类型回退到通用示例值', () => {
    expect(buildApiProperty('unknown', 'd', 'Record<string, unknown>', false)).toContain("example: 'example'");
  });
});

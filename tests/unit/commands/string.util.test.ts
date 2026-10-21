import { describe, expect, it } from 'vitest';

import {
  escapeTsString,
  pluralize,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from '@/commands/generator/utils/string.util';

describe('string.util（CRUD 生成器命名转换契约）', () => {
  it('基础命名转换：大小写边界与分隔符', () => {
    expect(toSnakeCase('UserProfile')).toBe('user_profile');
    expect(toSnakeCase('user-profile')).toBe('user_profile');
    expect(toSnakeCase('user_profile')).toBe('user_profile');
    expect(toCamelCase('user_profile')).toBe('userProfile');
    expect(toPascalCase('user_profile')).toBe('UserProfile');
    expect(toPascalCase('userProfile')).toBe('UserProfile');
  });

  it('含数字命名遵循 es-toolkit 单词边界规则（数字前后视为独立单词）', () => {
    expect(toSnakeCase('user2fa')).toBe('user_2_fa');
    expect(toSnakeCase('ipv6Address')).toBe('ipv_6_address');
    expect(toCamelCase('user_2_fa')).toBe('user2Fa');
    expect(toPascalCase('user2fa')).toBe('User2Fa');
  });

  it('复数化与 TS 字符串转义', () => {
    expect(pluralize('person')).toBe('people');
    expect(pluralize('category')).toBe('categories');
    expect(escapeTsString("it's \\ ok")).toBe("it\\'s \\\\ ok");
  });
});

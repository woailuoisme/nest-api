import { describe, expect, it } from 'vitest';

import { expandBracketKeys, parseSpatieQuerystring } from '@/setup/query-expander';

describe('Spatie Query String Expander', () => {
  describe('expandBracketKeys', () => {
    it('应将 filter[field] 展开为 filter 对象', () => {
      const expanded = expandBracketKeys({ 'filter[name]': 'John', 'filter[id]': '1,2,3' });
      expect(expanded).toEqual({ filter: { name: 'John', id: '1,2,3' } });
    });

    it('应将 fields[resource] 展开为 fields 对象', () => {
      const expanded = expandBracketKeys({ 'fields[users]': 'id,name' });
      expect(expanded).toEqual({ fields: { users: 'id,name' } });
    });

    it('其余参数应保持扁平不变', () => {
      const expanded = expandBracketKeys({ page: '2', sort: '-createdAt', include: 'posts', search: 'ali' });
      expect(expanded).toEqual({ page: '2', sort: '-createdAt', include: 'posts', search: 'ali' });
    });

    it('重复键应取最后一个值（Laravel parse_str 语义）', () => {
      const expanded = expandBracketKeys({ 'filter[name]': ['first', 'last'] });
      expect(expanded).toEqual({ filter: { name: 'last' } });
    });

    it('未在白名单内的括号键应原样保留', () => {
      const expanded = expandBracketKeys({ 'other[key]': 'v' });
      expect(expanded).toEqual({ 'other[key]': 'v' });
    });

    it('深层嵌套键不应被展开（仅支持一层）', () => {
      const expanded = expandBracketKeys({ 'filter[age][gte]': '18' });
      expect(expanded).toEqual({ 'filter[age][gte]': '18' });
    });

    it('同名标量键与括号键共存时不得抛错（保持先到者）', () => {
      expect(expandBracketKeys({ filter: 'x', 'filter[role]': 'ADMIN' })).toEqual({ filter: 'x' });
      expect(expandBracketKeys({ 'filter[role]': 'ADMIN', filter: 'x' })).toEqual({ filter: { role: 'ADMIN' } });
      expect(expandBracketKeys({ fields: 'x', 'fields[users]': 'id' })).toEqual({ fields: 'x' });
    });

    it('应拒绝原型链敏感键', () => {
      const expanded = expandBracketKeys({ 'filter[__proto__]': 'x', __proto__x: 'y', 'filter[constructor]': 'z' });
      expect(expanded).toEqual({ __proto__x: 'y' });
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    });
  });

  describe('parseSpatieQuerystring', () => {
    it('应解析并展开典型的 Spatie 查询串', () => {
      const parsed = parseSpatieQuerystring(
        'page=2&pageSize=10&filter[name]=John&filter[salary]=%3E%3D3000&sort=-createdAt&include=posts&fields[users]=id,name',
      );

      expect(parsed).toEqual({
        page: '2',
        pageSize: '10',
        filter: { name: 'John', salary: '>=3000' },
        sort: '-createdAt',
        include: 'posts',
        fields: { users: 'id,name' },
      });
    });

    it('应保留重复键以便按末值语义收敛', () => {
      const parsed = parseSpatieQuerystring('filter[role]=USER&filter[role]=ADMIN');
      expect(parsed).toEqual({ filter: { role: 'ADMIN' } });
    });

    it('原型链敏感键应被忽略', () => {
      const parsed = parseSpatieQuerystring('__proto__=polluted&constructor=bad&filter[role]=USER');
      expect(parsed).toEqual({ filter: { role: 'USER' } });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});

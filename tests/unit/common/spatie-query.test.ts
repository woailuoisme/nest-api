import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { buildSpatieConditions, parseSpatieQuery } from '@/common/query/spatie-query';

const mockTable = pgTable('mock_users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 100 }),
  role: varchar('role', { length: 20 }),
  status: varchar('status', { length: 20 }),
  salary: integer('salary'),
  note: text('note'),
  createdAt: timestamp('created_at'),
});

const dialect = new PgDialect();
const toSql = (condition: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(condition);

describe('Spatie Query Tooling', () => {
  describe('parseSpatieQuery — 参数解析', () => {
    it('应正确解析默认分页参数', () => {
      const parsed = parseSpatieQuery({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(20);
      expect(parsed.search).toBeUndefined();
      expect(parsed.filters).toEqual([]);
      expect(parsed.sorts).toEqual([]);
      expect(parsed.includes).toEqual([]);
      expect(parsed.fields).toEqual({});
    });

    it('普通过滤 filter[field]=value 应解析为等值条件', () => {
      const parsed = parseSpatieQuery({ filter: { name: 'John' } });
      expect(parsed.filters).toEqual([{ field: 'name', operator: '=', values: ['John'] }]);
    });

    it('逗号分隔多值应解析为多值条件（IN 语义）', () => {
      const parsed = parseSpatieQuery({ filter: { id: '1,2,3' } });
      expect(parsed.filters).toEqual([{ field: 'id', operator: '=', values: ['1', '2', '3'] }]);
    });

    it('值前缀动态算子应被识别（>= / <= / > / < / != / =）', () => {
      const parsed = parseSpatieQuery({
        filter: { salary: '>=3000', age: '<=60', score: '>90', rank: '<10', role: '!=ADMIN', name: '=John' },
      });

      expect(parsed.filters).toEqual(
        expect.arrayContaining([
          { field: 'salary', operator: '>=', values: ['3000'] },
          { field: 'age', operator: '<=', values: ['60'] },
          { field: 'score', operator: '>', values: ['90'] },
          { field: 'rank', operator: '<', values: ['10'] },
          { field: 'role', operator: '!=', values: ['ADMIN'] },
          { field: 'name', operator: '=', values: ['John'] },
        ]),
      );
    });

    it('<> 应归一化为 !=', () => {
      const parsed = parseSpatieQuery({ 'filter[role]': '<>ADMIN' });
      expect(parsed.filters).toEqual([{ field: 'role', operator: '!=', values: ['ADMIN'] }]);
    });

    it('比较算子只接受单值（逗号后续值忽略）', () => {
      const parsed = parseSpatieQuery({ 'filter[salary]': '>=3000,5000' });
      expect(parsed.filters).toEqual([{ field: 'salary', operator: '>=', values: ['3000'] }]);
    });

    it('扁平键形态与嵌套对象形态应等价', () => {
      const flat = parseSpatieQuery({ 'filter[role]': 'ADMIN', 'filter[email]': 'a@b.com' });
      const nested = parseSpatieQuery({ filter: { role: 'ADMIN', email: 'a@b.com' } });

      expect(flat.filters).toEqual(nested.filters);
    });

    it('重复键同名过滤应合并为多值', () => {
      const parsed = parseSpatieQuery({ 'filter[id]': ['1', '2'] });
      expect(parsed.filters).toEqual([{ field: 'id', operator: '=', values: ['1', '2'] }]);
    });

    it('空值与非法键应被忽略（含原型链敏感键）', () => {
      const parsed = parseSpatieQuery({
        'filter[name]': '   ',
        'filter[__proto__]': 'polluted',
        filter: { constructor: 'x' },
      });

      expect(parsed.filters).toEqual([]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('排序应支持多字段、降序前缀与重复参数', () => {
      const parsed = parseSpatieQuery({ sort: ['-createdAt,name', 'email'] });
      expect(parsed.sorts).toEqual([
        { field: 'createdAt', direction: 'desc' },
        { field: 'name', direction: 'asc' },
        { field: 'email', direction: 'asc' },
      ]);
    });

    it('include 应解析为去重的关联列表', () => {
      const parsed = parseSpatieQuery({ include: 'posts, comments,posts' });
      expect(parsed.includes).toEqual(['posts', 'comments']);
    });

    it('fields[resource] 应解析为稀疏字段集', () => {
      const parsed = parseSpatieQuery({ 'fields[users]': 'id,name,id' });
      expect(parsed.fields).toEqual({ users: ['id', 'name'] });
    });

    it('pageSize 应受到 1~100 边界约束 (clamp 防御)', () => {
      expect(parseSpatieQuery({ pageSize: -5 }).pageSize).toBe(1);
      expect(parseSpatieQuery({ pageSize: 500 }).pageSize).toBe(100);
      expect(parseSpatieQuery({ page: -3 }).page).toBe(1);
    });
  });

  describe('buildSpatieConditions — Drizzle 映射', () => {
    it('精确过滤应生成等值条件', () => {
      const parsed = parseSpatieQuery({ 'filter[role]': 'ADMIN' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: { role: mockTable.role },
      });

      expect(where).toBeDefined();
      const query = toSql(where!);
      expect(query.sql).toContain('"role" =');
      expect(query.params).toEqual(['ADMIN']);
    });

    it('多值精确过滤应生成 IN 条件', () => {
      const parsed = parseSpatieQuery({ 'filter[role]': 'ADMIN,OPERATOR' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: { role: mockTable.role },
      });

      const query = toSql(where!);
      expect(query.sql.toLowerCase()).toContain('in');
      expect(query.params).toEqual(['ADMIN', 'OPERATOR']);
    });

    it('动态算子应按数字列类型转换后比较', () => {
      const parsed = parseSpatieQuery({ 'filter[salary]': '>=3000' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: { salary: mockTable.salary },
      });

      const query = toSql(where!);
      expect(query.sql).toContain('>=');
      expect(query.params).toEqual([3000]);
    });

    it('数字列收到非法数值时应忽略该过滤', () => {
      const parsed = parseSpatieQuery({ 'filter[salary]': '>=abc' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: { salary: mockTable.salary },
      });

      expect(where).toBeUndefined();
    });

    it('partial 过滤应生成 ILIKE 条件，多值之间为 OR', () => {
      const parsed = parseSpatieQuery({ 'filter[name]': 'seb,freek' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        partialColumns: { name: mockTable.name },
      });

      const query = toSql(where!);
      expect(query.sql.toLowerCase()).toContain('ilike');
      expect(query.sql.toLowerCase()).toContain(' or ');
      expect(query.params).toEqual(['%seb%', '%freek%']);
    });

    it('partial 过滤应转义 LIKE 通配符', () => {
      const parsed = parseSpatieQuery({ 'filter[name]': '100%_off' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        partialColumns: { name: mockTable.name },
      });

      expect(toSql(where!).params).toEqual(['%100\\%\\_off%']);
    });

    it('未在白名单声明的字段应被忽略', () => {
      const parsed = parseSpatieQuery({ 'filter[note]': 'secret' });
      const { where } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: { role: mockTable.role },
      });

      expect(where).toBeUndefined();
    });

    it('排序白名单外字段应被忽略，并在无有效排序时回落 defaultOrderBy', () => {
      const untouched = buildSpatieConditions(mockTable, parseSpatieQuery({ sort: 'note' }), {
        sortableColumns: { createdAt: mockTable.createdAt },
        defaultOrderBy: mockTable.createdAt,
      });
      expect(untouched.orderBy).toHaveLength(1);

      const sorted = buildSpatieConditions(mockTable, parseSpatieQuery({ sort: '-createdAt' }), {
        sortableColumns: { createdAt: mockTable.createdAt },
        defaultOrderBy: mockTable.id,
      });
      expect(sorted.orderBy).toHaveLength(1);
      expect(toSql(sorted.orderBy[0] as never).sql).toContain('desc');
    });

    it('search 应对可检索列生成 ILIKE OR 条件', () => {
      const { where } = buildSpatieConditions(mockTable, parseSpatieQuery({ search: 'ali' }), {
        searchableColumns: [mockTable.name, mockTable.email],
      });

      const query = toSql(where!);
      expect(query.sql.toLowerCase()).toContain('ilike');
      expect(query.params).toEqual(['%ali%', '%ali%']);
    });

    it('日期列收到非法日期时应忽略该过滤（避免 PG 22007 → 500）', () => {
      const { where } = buildSpatieConditions(mockTable, parseSpatieQuery({ 'filter[createdAt]': '>notadate' }), {
        filterableColumns: { createdAt: mockTable.createdAt },
      });

      expect(where).toBeUndefined();
    });

    it('日期列合法值应转为 Date 并由驱动序列化为 ISO 字符串', () => {
      const { where } = buildSpatieConditions(
        mockTable,
        parseSpatieQuery({ 'filter[createdAt]': '>=2026-01-01T00:00:00.000Z' }),
        { filterableColumns: { createdAt: mockTable.createdAt } },
      );

      // PgTimestamp.mapToDriverValue 会调用 Date.prototype.toISOString，字符串入参将直接抛错
      expect(toSql(where!).params).toEqual(['2026-01-01T00:00:00.000Z']);
    });

    it('未声明字段应通过 ignoredFilters / ignoredSorts 回传', () => {
      const result = buildSpatieConditions(
        mockTable,
        parseSpatieQuery({ 'filter[note]': 'secret', sort: '-note,-createdAt' }),
        { filterableColumns: { role: mockTable.role }, sortableColumns: { createdAt: mockTable.createdAt } },
      );

      expect(result.ignoredFilters).toEqual(['note']);
      expect(result.ignoredSorts).toEqual(['note']);
      expect(result.orderBy).toHaveLength(1);
    });
  });

  describe('parseSpatieQuery — 防御上限', () => {
    it('单条过滤的值数量应受上限保护（100）', () => {
      const values = Array.from({ length: 150 }, (_, index) => String(index)).join(',');
      const parsed = parseSpatieQuery({ 'filter[id]': values });

      expect(parsed.filters[0]?.values).toHaveLength(100);
      expect(parsed.filters[0]?.values[99]).toBe('99');
    });
  });
});

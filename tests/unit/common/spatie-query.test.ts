import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { buildSpatieConditions, parseSpatieQuery } from '@/common/query/spatie-query';

const mockTable = pgTable('mock_users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 100 }),
  role: varchar('role', { length: 20 }),
  status: varchar('status', { length: 20 }),
  createdAt: timestamp('created_at'),
});

describe('Spatie Query Tooling', () => {
  describe('parseSpatieQuery', () => {
    it('应正确解析默认分页参数', () => {
      const parsed = parseSpatieQuery({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(20);
      expect(parsed.search).toBeUndefined();
      expect(parsed.filters).toEqual({});
      expect(parsed.sorts).toEqual([]);
    });

    it('应正确解析对象形式的 filter[key]=val 与复合排序', () => {
      const parsed = parseSpatieQuery({
        page: '2',
        pageSize: '50',
        search: '  alice ',
        filter: {
          role: 'ADMIN',
          status: 'ACTIVE,PENDING',
        },
        sort: '-createdAt,name',
      });

      expect(parsed.page).toBe(2);
      expect(parsed.pageSize).toBe(50);
      expect(parsed.search).toBe('alice');
      expect(parsed.filters).toEqual({
        role: 'ADMIN',
        status: 'ACTIVE,PENDING',
      });
      expect(parsed.sorts).toEqual([
        { field: 'createdAt', direction: 'desc' },
        { field: 'name', direction: 'asc' },
      ]);
    });

    it('应正确解析扁平键形式的 filter[key]', () => {
      const parsed = parseSpatieQuery({
        'filter[email]': 'test@example.com',
        'filter[createdAtAfter]': '2026-01-01',
      });

      expect(parsed.filters).toEqual({
        email: 'test@example.com',
        createdAtAfter: '2026-01-01',
      });
    });

    it('pageSize 应受到 1~100 边界约束 (clamp 防御)', () => {
      const minParsed = parseSpatieQuery({ pageSize: -5 });
      expect(minParsed.pageSize).toBe(1);

      const maxParsed = parseSpatieQuery({ pageSize: 500 });
      expect(maxParsed.pageSize).toBe(100);
    });
  });

  describe('buildSpatieConditions', () => {
    it('应将 filter 映射为 Drizzle 的 WHERE 条件', () => {
      const parsed = parseSpatieQuery({
        filter: {
          role: 'ADMIN',
          status: 'ACTIVE,SUSPENDED',
        },
        search: 'keyword',
        sort: '-createdAt',
      });

      const { where, orderBy } = buildSpatieConditions(mockTable, parsed, {
        filterableColumns: {
          role: mockTable.role,
          status: mockTable.status,
        },
        searchableColumns: [mockTable.name, mockTable.email],
        sortableColumns: {
          createdAt: mockTable.createdAt,
        },
      });

      expect(where).toBeDefined();
      expect(orderBy.length).toBe(1);
    });

    it('未指定 sort 时应使用 defaultOrderBy 防 Page Drift', () => {
      const parsed = parseSpatieQuery({});
      const { orderBy } = buildSpatieConditions(mockTable, parsed, {
        defaultOrderBy: mockTable.createdAt,
      });

      expect(orderBy.length).toBe(1);
    });
  });
});

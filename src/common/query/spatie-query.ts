import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { clamp } from 'es-toolkit';
import { PAGINATION } from '@/common/constants/app.constants';

/** 解析后的标准 Spatie 查询结构 */
export interface ParsedSpatieQuery {
  page: number;
  pageSize: number;
  search?: string;
  filters: Record<string, string>;
  sorts: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export interface SpatieMappingOptions<_TTable extends PgTable = PgTable> {
  /** 允许参与 filter 过滤的列白名单映射（如 { role: user.role, status: user.status }） */
  filterableColumns?: Record<string, PgColumn>;
  /** 允许参与全文模糊搜索的列集合（如 [user.name, user.email]） */
  searchableColumns?: PgColumn[];
  /** 允许排序的字段白名单映射（如 { createdAt: user.createdAt, name: user.name }） */
  sortableColumns?: Record<string, PgColumn>;
  /** 默认排序策略（防 Page Drift 数据漂移） */
  defaultOrderBy?: SQL | PgColumn | (SQL | PgColumn)[];
}

/**
 * 解析 HTTP Query 请求中的 Spatie / JSON:API 风格参数：
 * - `filter[field]=value` 或 `filter[field]=a,b,c`
 * - `filter[fieldAfter]=2026-01-01` 或 `filter[fieldBefore]=...`
 * - `sort=-createdAt,name`
 * - `search=keyword`
 * - `page=1&pageSize=20`
 */
export function parseSpatieQuery(rawQuery: Record<string, unknown> = {}): ParsedSpatieQuery {
  const rawPage = Number(rawQuery.page) || PAGINATION.DEFAULT_PAGE;
  const rawPageSize = Number(rawQuery.pageSize) || PAGINATION.DEFAULT_PER_PAGE;
  const page = Math.max(1, rawPage);
  const pageSize = clamp(rawPageSize, 1, PAGINATION.MAX_PER_PAGE);

  const search = typeof rawQuery.search === 'string' ? rawQuery.search.trim() : undefined;

  const filters: Record<string, string> = {};

  // 处理 filter 对象形式 (如 qs 解析的 query.filter = { name: 'xxx' })
  if (rawQuery.filter && typeof rawQuery.filter === 'object') {
    for (const [k, v] of Object.entries(rawQuery.filter as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() !== '') {
        filters[k] = v.trim();
      }
    }
  }

  // 处理扁平字符串形式 (如 query['filter[name]'] = 'xxx')
  for (const [key, value] of Object.entries(rawQuery)) {
    const match = key.match(/^filter\[([a-zA-Z0-9_]+)\]$/);
    if (match?.[1] && typeof value === 'string' && value.trim() !== '') {
      filters[match[1]] = value.trim();
    }
  }

  // 处理 sort 表达式 (如 sort=-createdAt,name)
  const sorts: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
  const rawSort = typeof rawQuery.sort === 'string' ? rawQuery.sort : undefined;
  if (rawSort) {
    const parts = rawSort
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('-')) {
        sorts.push({ field: part.slice(1), direction: 'desc' });
      } else {
        sorts.push({ field: part, direction: 'asc' });
      }
    }
  }

  return {
    page,
    pageSize,
    search: search || undefined,
    filters,
    sorts,
  };
}

/**
 * 将解析出的 Spatie 查询参数安全映射为 Drizzle ORM 的 WHERE 条件与 ORDER BY 条件
 */
export function buildSpatieConditions<TTable extends PgTable>(
  _table: TTable,
  parsed: ParsedSpatieQuery,
  options: SpatieMappingOptions<TTable> = {},
): { where?: SQL; orderBy: (SQL | PgColumn)[] } {
  const conditions: SQL[] = [];

  // 1. 字段过滤 (Filters)
  if (options.filterableColumns) {
    for (const [filterKey, filterValue] of Object.entries(parsed.filters)) {
      // 检查精确匹配与多值匹配 (IN 查询)
      const exactCol = options.filterableColumns[filterKey];
      if (exactCol) {
        if (filterValue.includes(',')) {
          const values = filterValue
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
          if (values.length > 0) {
            conditions.push(inArray(exactCol, values));
          }
        } else {
          conditions.push(eq(exactCol, filterValue));
        }
        continue;
      }

      // 检查区间过滤 (After / Min -> gte)
      if (filterKey.endsWith('After') || filterKey.endsWith('Min')) {
        const baseKey = filterKey.replace(/(After|Min)$/, '');
        const col = options.filterableColumns[baseKey];
        if (col) {
          conditions.push(gte(col, filterValue));
        }
        continue;
      }

      // 检查区间过滤 (Before / Max -> lte)
      if (filterKey.endsWith('Before') || filterKey.endsWith('Max')) {
        const baseKey = filterKey.replace(/(Before|Max)$/, '');
        const col = options.filterableColumns[baseKey];
        if (col) {
          conditions.push(lte(col, filterValue));
        }
      }
    }
  }

  // 2. 全文模糊搜索 (Search)
  if (parsed.search && options.searchableColumns && options.searchableColumns.length > 0) {
    const searchPattern = `%${parsed.search}%`;
    const searchConditions = options.searchableColumns.map((col) => ilike(col, searchPattern));
    if (searchConditions.length === 1) {
      conditions.push(searchConditions[0]);
    } else if (searchConditions.length > 1) {
      conditions.push(or(...searchConditions) as SQL);
    }
  }

  // 3. 排序 (Sorts)
  const orderClauses: (SQL | PgColumn)[] = [];
  if (options.sortableColumns && parsed.sorts.length > 0) {
    for (const sortItem of parsed.sorts) {
      const col = options.sortableColumns[sortItem.field];
      if (col) {
        orderClauses.push(sortItem.direction === 'desc' ? desc(col) : asc(col));
      }
    }
  }

  // 兜底默认排序
  if (orderClauses.length === 0 && options.defaultOrderBy) {
    const defaults = Array.isArray(options.defaultOrderBy) ? options.defaultOrderBy : [options.defaultOrderBy];
    orderClauses.push(...defaults);
  }

  return {
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: orderClauses,
  };
}

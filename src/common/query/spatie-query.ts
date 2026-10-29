import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, ne, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { clamp } from 'es-toolkit';

import { PAGINATION } from '@/common/constants/app.constants';

/**
 * URL 级动态比较算子（对齐 Spatie `FilterOperator::DYNAMIC`）。
 *
 * 写法：算子紧贴值前缀 —— `filter[salary]=>=3000`（`>=` 需编码为 `%3E%3D`）。
 */
const DYNAMIC_OPERATORS = ['>=', '<=', '!=', '<>', '>', '<', '='] as const;

/** 解析后的过滤算子（`<>` 归一化为 `!=`；多值不设 `in`，由 `values.length > 1` 判定） */
export type FilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

/** 单条过滤允许的最大值数量：防 `filter[id]=<上万值>` 撑爆 SQL 绑定参数上限 */
const MAX_VALUES_PER_FILTER = 100;

/** 单条过滤条件（同一字段的多个值会合并到 `values`） */
export interface ParsedFilter {
  field: string;
  operator: FilterOperator;
  /** 逗号分隔 / 重复键展开后的值列表；`operator` 为比较算子时仅取首个 */
  values: string[];
}

/** 解析后的排序项 */
export interface ParsedSort {
  field: string;
  direction: 'asc' | 'desc';
}

/** 解析后的标准 Spatie / JSON:API 查询结构 */
export interface ParsedSpatieQuery {
  page: number;
  pageSize: number;
  search?: string;
  filters: ParsedFilter[];
  sorts: ParsedSort[];
  /** `include=posts,comments` → `['posts', 'comments']`（关联预加载由调用方决定如何消费） */
  includes: string[];
  /** `fields[users]=id,name` → `{ users: ['id', 'name'] }`（稀疏字段集，由调用方消费） */
  fields: Record<string, string[]>;
}

/** 过滤字段白名单映射：键为 URL 中的字段名，值为对应的 Drizzle 列 */
export interface SpatieMappingOptions<_TTable extends PgTable = PgTable> {
  /** 精确过滤（对齐 `AllowedFilter::exact`）：`=` / `!=` / `>` / `>=` / `<` / `<=`，多值自动 IN */
  filterableColumns?: Record<string, PgColumn>;
  /** 模糊过滤（对齐 `AllowedFilter::partial`）：`ILIKE %value%`，多值之间为 OR */
  partialColumns?: Record<string, PgColumn>;
  /** 允许参与全文模糊搜索的列集合（对齐自定义 search 过滤器） */
  searchableColumns?: PgColumn[];
  /** 允许排序的字段白名单映射（如 { createdAt: user.createdAt, name: user.name }） */
  sortableColumns?: Record<string, PgColumn>;
  /** 默认排序策略（防 Page Drift 数据漂移） */
  defaultOrderBy?: SQL | PgColumn | (SQL | PgColumn)[];
}

// ─── 解析 ───────────────────────────────────────────────

/** `filter[name]` 扁平键（Fastify 内置解析器不展开括号，键名原样到达） */
const FILTER_KEY_PATTERN = /^filter\[([A-Za-z0-9_]{1,64})\]$/;
/** `fields[users]` 扁平键 */
const FIELDS_KEY_PATTERN = /^fields\[([A-Za-z0-9_]{1,64})\]$/;
/** 原型链敏感键：写入对象前一律拒绝 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 关系名允许点号（如 `posts.comments`）；字段名不允许 */
const RELATION_TOKEN_PATTERN = /^[A-Za-z0-9_.]{1,64}$/;
/** 排序 token 允许 `-` 前缀（降序） */
const SORT_TOKEN_PATTERN = /^-?[A-Za-z0-9_.]{1,64}$/;
/** 稀疏字段集里的列名 */
const FIELD_TOKEN_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * 解析 HTTP Query 中的 Spatie Query Builder 风格参数（v7 口径）：
 *
 * | 功能 | URL | 说明 |
 * |---|---|---|
 * | 普通过滤 | `filter[name]=John` | 精确匹配（模糊需在映射层声明 partialColumns） |
 * | 多值过滤 | `filter[id]=1,2,3` | 精确过滤按 IN；partial 过滤多值之间 OR |
 * | 动态算子 | `filter[salary]=>=3000` | 支持 `=` `!=` `>` `>=` `<` `<=`（`<>` 同 `!=`） |
 * | 排序 | `sort=-createdAt,name` | `-` 前缀为降序，逗号分隔多字段 |
 * | 关联加载 | `include=posts,comments` | 仅解析，加载策略由调用方决定 |
 * | 字段选择 | `fields[users]=id,name` | 稀疏字段集，仅解析 |
 *
 * 兼容两种输入形态：`{ filter: { name: 'John' } }`（适配器/qs 展开后）与
 * `{ 'filter[name]': 'John' }`（Fastify 内置扁平解析器原样键名）。
 */
export function parseSpatieQuery(rawQuery: Record<string, unknown> = {}): ParsedSpatieQuery {
  const rawPage = Number(rawQuery.page) || PAGINATION.DEFAULT_PAGE;
  const rawPageSize = Number(rawQuery.pageSize) || PAGINATION.DEFAULT_PER_PAGE;

  return {
    page: Math.max(1, rawPage),
    pageSize: clamp(rawPageSize, 1, PAGINATION.MAX_PER_PAGE),
    search: parseSearch(rawQuery.search),
    filters: parseFilters(rawQuery),
    sorts: parseSorts(rawQuery.sort),
    includes: parseIncludes(rawQuery.include),
    fields: parseFields(rawQuery.fields, rawQuery),
  };
}

/** 搜索关键词：去空白，空串视为未提供 */
function parseSearch(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const keyword = raw.trim();
  return keyword === '' ? undefined : keyword;
}

/**
 * 收集「嵌套对象 + 扁平 `prefix[key]`」两种形态的条目。
 *
 * 例如 `{ filter: { role: 'ADMIN' } }` 与 `{ 'filter[role]': 'ADMIN' }` 都能取到 `['role', 'ADMIN']`。
 */
function collectEntries(nested: unknown, flatPattern: RegExp, rawQuery: Record<string, unknown>): [string, unknown][] {
  const entries: [string, unknown][] =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.entries(nested as Record<string, unknown>)
      : [];

  for (const [key, value] of Object.entries(rawQuery)) {
    const matched = flatPattern.exec(key);
    if (matched?.[1]) entries.push([matched[1], value]);
  }

  return entries;
}

/** 展开重复参数与逗号分隔值，按模式过滤并去重（保持首次出现的顺序） */
function flattenTokens(raw: unknown, pattern: RegExp): string[] {
  const tokens = new Set<string>();

  for (const expression of toValueList(raw)) {
    for (const token of expression.split(',')) {
      const value = token.trim();
      if (pattern.test(value)) tokens.add(value);
    }
  }

  return [...tokens];
}

/** 解析全部过滤条件；同一字段 + 同一算子合并多值，同字段不同算子各自生效（AND） */
function parseFilters(rawQuery: Record<string, unknown>): ParsedFilter[] {
  const merged = new Map<string, ParsedFilter>();

  for (const [field, rawValue] of collectEntries(rawQuery.filter, FILTER_KEY_PATTERN, rawQuery)) {
    if (FORBIDDEN_KEYS.has(field)) continue;

    for (const raw of toValueList(rawValue)) {
      const parsed = parseFilterValue(field, raw);
      if (!parsed) continue;

      const key = `${field}\u0000${parsed.operator}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, parsed);
        continue;
      }
      // 比较算子只接受单值，重复值忽略；`=` 允许合并为多值（IN）
      if (parsed.operator === '=') existing.values.push(...parsed.values);
    }
  }

  return [...merged.values()];
}

/** 单值解析：先取动态算子前缀，再按逗号切分多值 */
function parseFilterValue(field: string, raw: string): ParsedFilter | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  const match = DYNAMIC_OPERATORS.find((op) => trimmed.startsWith(op));
  // `<>` 归一化为 `!=`；其余前缀本身就是合法算子，无需断言
  const operator: FilterOperator = match === '<>' ? '!=' : (match ?? '=');
  const rawValues = match ? trimmed.slice(match.length) : trimmed;

  const values = rawValues
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .slice(0, MAX_VALUES_PER_FILTER);
  if (values.length === 0) return undefined;

  // 比较算子语义上是单值；多值仅 `=` 有意义（IN）
  return { field, operator, values: operator === '=' ? values : values.slice(0, 1) };
}

/** 统一把 `string | string[] | number | boolean` 归一化为字符串列表 */
function toValueList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => toValueList(item));
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return [];
}

/** 解析 `sort=-createdAt,name`（支持重复 sort 参数）；同字段只保留首次出现的方向 */
function parseSorts(raw: unknown): ParsedSort[] {
  const seen = new Set<string>();
  const sorts: ParsedSort[] = [];

  for (const token of flattenTokens(raw, SORT_TOKEN_PATTERN)) {
    const descending = token.startsWith('-');
    const field = descending ? token.slice(1) : token;
    if (seen.has(field)) continue;

    seen.add(field);
    sorts.push({ field, direction: descending ? 'desc' : 'asc' });
  }

  return sorts;
}

/** 解析 `include=posts,comments` */
function parseIncludes(raw: unknown): string[] {
  return flattenTokens(raw, RELATION_TOKEN_PATTERN);
}

/** 解析 `fields[users]=id,name`（兼容嵌套 `{ fields: { users: 'id,name' } }`） */
function parseFields(rawFields: unknown, rawQuery: Record<string, unknown>): Record<string, string[]> {
  // 同一资源可能同时出现在嵌套对象与扁平键中：先按资源归并再统一去重
  const valuesByResource = new Map<string, unknown[]>();

  for (const [resource, rawValue] of collectEntries(rawFields, FIELDS_KEY_PATTERN, rawQuery)) {
    if (FORBIDDEN_KEYS.has(resource)) continue;

    const values = valuesByResource.get(resource) ?? [];
    values.push(rawValue);
    valuesByResource.set(resource, values);
  }

  const fields: Record<string, string[]> = {};
  for (const [resource, values] of valuesByResource) {
    const selected = flattenTokens(values, FIELD_TOKEN_PATTERN);
    if (selected.length > 0) fields[resource] = selected;
  }

  return fields;
}

// ─── 映射为 Drizzle 条件 ─────────────────────────────────

/**
 * 将解析出的 Spatie 查询参数安全映射为 Drizzle ORM 的 WHERE 与 ORDER BY 条件。
 *
 * 白名单为唯一准入依据：未在 `filterableColumns` / `partialColumns` / `sortableColumns`
 * 中声明的字段一律忽略（对齐 Spatie「未声明过滤器不生效」的语义，但不抛异常）。
 *
 * 被忽略的字段通过 `ignoredFilters` / `ignoredSorts` 回传给调用方，便于需要严格模式时
 * 由端点自行抛 400，避免「静默无效果」无从排查。
 */
export function buildSpatieConditions<TTable extends PgTable>(
  _table: TTable,
  parsed: ParsedSpatieQuery,
  options: SpatieMappingOptions<TTable> = {},
): { where?: SQL; orderBy: (SQL | PgColumn)[]; ignoredFilters: string[]; ignoredSorts: string[] } {
  const conditions: SQL[] = [];
  const ignoredFilters: string[] = [];

  for (const filter of parsed.filters) {
    if (!isFilterDeclared(filter, options)) {
      ignoredFilters.push(filter.field);
      continue;
    }

    const condition = buildFilterCondition(filter, options);
    if (condition) conditions.push(condition);
  }

  if (parsed.search && options.searchableColumns && options.searchableColumns.length > 0) {
    const pattern = `%${escapeLike(parsed.search)}%`;
    const searchConditions = options.searchableColumns.map((column) => ilike(column, pattern));
    const searchCondition = searchConditions.length === 1 ? searchConditions[0] : or(...searchConditions);
    if (searchCondition) conditions.push(searchCondition);
  }

  const orderClauses: (SQL | PgColumn)[] = [];
  const ignoredSorts: string[] = [];
  for (const sort of parsed.sorts) {
    const column = options.sortableColumns?.[sort.field];
    if (column) {
      orderClauses.push(sort.direction === 'desc' ? desc(column) : asc(column));
    } else {
      ignoredSorts.push(sort.field);
    }
  }

  if (orderClauses.length === 0 && options.defaultOrderBy) {
    const defaults = Array.isArray(options.defaultOrderBy) ? options.defaultOrderBy : [options.defaultOrderBy];
    orderClauses.push(...defaults);
  }

  return {
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: orderClauses,
    ignoredFilters,
    ignoredSorts,
  };
}

/** 字段是否已在白名单声明（比较算子仅精确过滤列可用） */
function isFilterDeclared(filter: ParsedFilter, options: SpatieMappingOptions): boolean {
  if (filter.operator === '=') {
    return Boolean(options.filterableColumns?.[filter.field] ?? options.partialColumns?.[filter.field]);
  }
  return Boolean(options.filterableColumns?.[filter.field]);
}

/** 单条过滤 → SQL 条件；未声明或值非法时返回 undefined（静默忽略） */
function buildFilterCondition(filter: ParsedFilter, options: SpatieMappingOptions): SQL | undefined {
  const exactColumn = options.filterableColumns?.[filter.field];
  const partialColumn = options.partialColumns?.[filter.field];

  if (filter.operator === '=') {
    // 精确过滤：多值走 IN
    if (exactColumn) {
      if (filter.values.length > 1) {
        const values = filter.values
          .map((value) => coerceValue(exactColumn, value))
          .filter((value) => value !== undefined);
        return values.length > 0 ? inArray(exactColumn, values) : undefined;
      }
      const value = coerceValue(exactColumn, filter.values[0]!);
      return value === undefined ? undefined : eq(exactColumn, value);
    }

    // 模糊过滤（对齐 AllowedFilter::partial）：多值之间 OR
    if (partialColumn) {
      const patterns = filter.values.map((value) => ilike(partialColumn, `%${escapeLike(value)}%`));
      return patterns.length === 1 ? patterns[0] : or(...patterns);
    }

    return undefined;
  }

  // 动态比较算子只在精确过滤列上生效
  if (!exactColumn) return undefined;

  const value = coerceValue(exactColumn, filter.values[0]!);
  if (value === undefined) return undefined;

  switch (filter.operator) {
    case '!=':
      return ne(exactColumn, value);
    case '>':
      return gt(exactColumn, value);
    case '>=':
      return gte(exactColumn, value);
    case '<':
      return lt(exactColumn, value);
    case '<=':
      return lte(exactColumn, value);
    default:
      return undefined;
  }
}

/**
 * 按列类型做最小必要的字面量转换（对齐 Spatie exact 过滤的自动类型映射）。
 *
 * 数字列不合法时返回 undefined（该过滤被忽略），布尔列接受 `true/1/false/0`；
 * 日期列必须转为 `Date` —— Drizzle 的 timestamp 列在构建 SQL 时调用 `toISOString()`，
 * 直接传字符串会抛 `TypeError`（500），非法日期同样返回 undefined 静默忽略；
 * 其余类型直接透传。
 */
function coerceValue(column: PgColumn, raw: string): string | number | boolean | Date | undefined {
  // Drizzle v1 的 dataType 是复合值（如 `number int32` / `object date` / `string uuid`），首段才是基础类型
  const [baseType, subType] = column.dataType.split(' ');

  switch (baseType) {
    case 'number': {
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'boolean': {
      const normalized = raw.toLowerCase();
      if (['true', '1', 't', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'f', 'no'].includes(normalized)) return false;
      return undefined;
    }
    case 'object': {
      // 仅 timestamp 需要转为 Date；json 列（`object json`）保持原值
      if (subType !== 'date') return raw;
      const timestamp = Date.parse(raw);
      return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
    }
    default:
      return raw;
  }
}

/** 转义 LIKE 通配符（`\` 为 PostgreSQL LIKE 默认转义符，无需额外 ESCAPE 子句） */
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

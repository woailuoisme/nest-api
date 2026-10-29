import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { clamp, isEmptyObject } from 'es-toolkit';

import { PAGINATION } from '@/common/constants/app.constants';
import { buildSpatieConditions, type ParsedSpatieQuery, type SpatieMappingOptions } from '@/common/query/spatie-query';

import type { Database } from './database';

export interface PaginateQueryOptions<TColumns = undefined> {
  page?: number;
  pageSize?: number;
  where?: SQL | undefined;
  orderBy?: SQL | PgColumn | (SQL | PgColumn)[];
  /** 可选列投影字典 — 仅查询指定列（如 { id: users.id, name: users.name }），避免敏感字段载入内存 */
  columns?: TColumns;
}

export interface PaginatedRows<T> {
  rows: T[];
  total: number;
}

/**
 * 通用类型安全 Drizzle 分页查询函数
 *
 * 支持列投影（Column Projection）、并行数据查询与 $count 计数，自动计算 offset 与 limit。
 */
export async function paginateQuery<
  TTable extends PgTable,
  TColumns extends Record<string, PgColumn | SQL | SQL.Aliased> | undefined = undefined,
  TSelect = TColumns extends Record<string, PgColumn | SQL | SQL.Aliased>
    ? { [K in keyof TColumns]: TColumns[K] extends { _: { data: infer D } } ? D : unknown }
    : TTable extends { $inferSelect: infer R }
      ? R
      : never,
>(db: Database, table: TTable, options: PaginateQueryOptions<TColumns>): Promise<PaginatedRows<TSelect>> {
  const page = options.page && options.page > 0 ? options.page : PAGINATION.DEFAULT_PAGE;
  const rawPageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : PAGINATION.DEFAULT_PER_PAGE;
  // 防御兜底：内部调用绕过 HTTP 层时仍约束上限，避免无界查询拖垮数据库
  const pageSize = clamp(rawPageSize, 1, PAGINATION.MAX_PER_PAGE);
  const offset = (page - 1) * pageSize;

  const whereClause = options.where;
  const orderByClause = options.orderBy;

  const hasColumns = Boolean(options.columns && !isEmptyObject(options.columns));

  let query = (
    hasColumns ? db.select(options.columns as NonNullable<TColumns>).from(table) : db.select().from(table)
  ).$dynamic();

  if (whereClause) {
    query = query.where(whereClause);
  }
  if (orderByClause) {
    const orders = Array.isArray(orderByClause) ? orderByClause : [orderByClause];
    query = query.orderBy(...orders);
  }
  const paginatedQuery = query.limit(pageSize).offset(offset);

  const [rows, total] = await Promise.all([
    paginatedQuery,
    whereClause ? db.$count(table, whereClause) : db.$count(table),
  ]);

  return { rows: rows as unknown as TSelect[], total };
}

/**
 * 结合 Spatie 风格参数的类型安全通用 Drizzle 分页查询函数
 */
export async function paginateSpatieQuery<
  TTable extends PgTable,
  TColumns extends Record<string, PgColumn | SQL | SQL.Aliased> | undefined = undefined,
  TSelect = TColumns extends Record<string, PgColumn | SQL | SQL.Aliased>
    ? { [K in keyof TColumns]: TColumns[K] extends { _: { data: infer D } } ? D : unknown }
    : TTable extends { $inferSelect: infer R }
      ? R
      : never,
>(
  db: Database,
  table: TTable,
  parsedQuery: ParsedSpatieQuery,
  mappingOptions: SpatieMappingOptions<TTable>,
  columns?: TColumns,
): Promise<PaginatedRows<TSelect>> {
  const { where, orderBy } = buildSpatieConditions(table, parsedQuery, mappingOptions);

  return paginateQuery(db, table, {
    page: parsedQuery.page,
    pageSize: parsedQuery.pageSize,
    where,
    orderBy,
    columns,
  });
}

import { type SQL, Table } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { clamp, isEmptyObject } from 'es-toolkit';
import { PAGINATION } from '@/common/constants/app.constants';

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
  TSchema extends Record<string, unknown>,
  TTable extends PgTable,
  TColumns extends Record<string, PgColumn | SQL | SQL.Aliased> | undefined = undefined,
  TSelect = TColumns extends Record<string, PgColumn | SQL | SQL.Aliased>
    ? { [K in keyof TColumns]: TColumns[K] extends PgColumn<infer C> ? C['data'] : unknown }
    : TTable['$inferSelect'],
>(
  db: NodePgDatabase<TSchema>,
  table: TTable,
  options: PaginateQueryOptions<TColumns>,
): Promise<PaginatedRows<TSelect>> {
  const page = options.page && options.page > 0 ? options.page : PAGINATION.DEFAULT_PAGE;
  const rawPageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : PAGINATION.DEFAULT_PER_PAGE;
  // 防御兜底：内部调用绕过 HTTP 层时仍约束上限，避免无界查询拖垮数据库
  const pageSize = clamp(rawPageSize, 1, PAGINATION.MAX_PER_PAGE);
  const offset = (page - 1) * pageSize;

  const whereClause = options.where;
  const orderByClause = options.orderBy;

  const hasColumns = Boolean(options.columns && !isEmptyObject(options.columns));

  let query = hasColumns
    ? db.select(options.columns as NonNullable<TColumns>).from(table as Table)
    : db.select().from(table as Table);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }
  if (orderByClause) {
    const orders = Array.isArray(orderByClause) ? orderByClause : [orderByClause];
    query = query.orderBy(...orders) as typeof query;
  }
  const paginatedQuery = query.limit(pageSize).offset(offset);

  const [rows, total] = await Promise.all([
    paginatedQuery,
    whereClause ? db.$count(table as Table, whereClause) : db.$count(table as Table),
  ]);

  return { rows: rows as unknown as TSelect[], total };
}

/**
 * 结合 Spatie 风格参数的类型安全通用 Drizzle 分页查询函数
 */
export async function paginateSpatieQuery<
  TSchema extends Record<string, unknown>,
  TTable extends PgTable,
  TColumns extends Record<string, PgColumn | SQL | SQL.Aliased> | undefined = undefined,
  TSelect = TColumns extends Record<string, PgColumn | SQL | SQL.Aliased>
    ? { [K in keyof TColumns]: TColumns[K] extends PgColumn<infer C> ? C['data'] : unknown }
    : TTable['$inferSelect'],
>(
  db: NodePgDatabase<TSchema>,
  table: TTable,
  parsedQuery: import('@/common/query/spatie-query').ParsedSpatieQuery,
  mappingOptions: import('@/common/query/spatie-query').SpatieMappingOptions<TTable>,
  columns?: TColumns,
): Promise<PaginatedRows<TSelect>> {
  const { buildSpatieConditions } = await import('@/common/query/spatie-query');
  const { where, orderBy } = buildSpatieConditions(table, parsedQuery, mappingOptions);

  return paginateQuery(db, table, {
    page: parsedQuery.page,
    pageSize: parsedQuery.pageSize,
    where,
    orderBy,
    columns,
  });
}

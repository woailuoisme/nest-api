import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { PAGINATION } from '@/common/constants/app.constants';

export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGINATION.MAX_PER_PAGE)
  .optional()
  .describe('Items per page');

export const PageOptionsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().describe('Current page number'),
  pageSize: PageSizeSchema,
});

export type PageOptionsRequest = z.infer<typeof PageOptionsSchema>;

export class PageMetaResource {
  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 20, description: 'Items per page' })
  pageSize: number;

  @ApiProperty({ example: 100, description: 'Total item count' })
  total: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  constructor(pageOptionsDto: { page?: number; pageSize?: number }, total: number) {
    this.page = pageOptionsDto.page ?? PAGINATION.DEFAULT_PAGE;
    this.pageSize = pageOptionsDto.pageSize ?? PAGINATION.DEFAULT_PER_PAGE;
    this.total = total;
    this.totalPages = Math.ceil(total / this.pageSize) || 1;
  }
}

export class PaginatedResultResource<T> {
  @ApiProperty({ isArray: true, description: '列表数据集合（空数据时保底为空数组 []）' })
  readonly items: T[];

  @ApiProperty({ type: PageMetaResource, description: 'Offset 分页元数据' })
  readonly meta: PageMetaResource;

  /** 向后兼容别名 */
  get pagination(): PageMetaResource {
    return this.meta;
  }

  constructor(items: T[], pagination: PageMetaResource) {
    this.items = Array.isArray(items) ? items : [];
    this.meta = pagination;
  }
}

export const CursorPageOptionsSchema = z.object({
  cursor: z.string().optional().describe('Cursor identifier for pagination'),
  pageSize: PageSizeSchema,
});

export type CursorPageOptionsRequest = z.infer<typeof CursorPageOptionsSchema>;

// ─── 分页输出契约（同一 schema 驱动运行时响应序列化与 OpenAPI 文档）────────────────

/** Offset 分页元数据 schema（字段与 PageMetaResource 严格一致） */
export const PageMetaSchema = z.object({
  page: z.number().int().describe('Current page number'),
  pageSize: z.number().int().describe('Items per page'),
  total: z.number().int().describe('Total item count'),
  totalPages: z.number().int().describe('Total number of pages'),
});

/** Cursor 分页元数据 schema（字段与 CursorPageMetaResource 严格一致） */
export const CursorPageMetaSchema = z.object({
  hasMore: z.boolean().describe('Indicates if there are more items'),
  nextCursor: z.string().nullable().describe('Cursor to pass for next page'),
  prevCursor: z.string().nullable().describe('Cursor to pass for previous page'),
});

/** `{ items, meta }` 信封共建：两种分页仅元数据 schema 与描述不同（泛型保留 meta 的具体类型） */
function buildEnvelopeSchema<TItem extends z.ZodType, TMeta extends z.ZodType>(
  item: TItem,
  meta: TMeta,
  metaDescription: string,
) {
  return z.object({
    items: z.array(item).describe('列表数据集合（空数据时保底为空数组 []）'),
    meta: meta.describe(metaDescription),
  });
}

/**
 * 分页信封 schema 工厂：把资源 schema 包装为 `{ items, meta }` 输出契约。
 *
 * 供 `@SerializeOptions({ schema })` 运行时序列化与 OpenAPI 响应文档共用，确保两种分页信封结构永不漂移。
 */
export function paginatedEnvelopeSchema<T extends z.ZodType>(item: T) {
  return buildEnvelopeSchema(item, PageMetaSchema, 'Offset 分页元数据');
}

/** Cursor 分页信封 schema 工厂 */
export function cursorPaginatedEnvelopeSchema<T extends z.ZodType>(item: T) {
  return buildEnvelopeSchema(item, CursorPageMetaSchema, 'Cursor 游标分页元数据');
}

export class CursorPageMetaResource {
  @ApiProperty({ example: true, description: 'Indicates if there are more items' })
  hasMore: boolean;

  @ApiProperty({ example: 'log_01j6k8y9z0a1b9', nullable: true, description: 'Cursor to pass for next page' })
  nextCursor: string | null;

  @ApiProperty({ example: 'log_01j6k8y9z0', nullable: true, description: 'Cursor to pass for previous page' })
  prevCursor: string | null;

  constructor({
    hasMore,
    nextCursor = null,
    prevCursor = null,
  }: {
    hasMore: boolean;
    nextCursor?: string | null;
    prevCursor?: string | null;
  }) {
    this.hasMore = hasMore;
    this.nextCursor = nextCursor;
    this.prevCursor = prevCursor;
  }
}

export class CursorPaginatedResultResource<T> {
  @ApiProperty({ isArray: true, description: '列表数据集合（空数据时保底为空数组 []）' })
  readonly items: T[];

  @ApiProperty({ type: CursorPageMetaResource, description: 'Cursor 游标分页元数据' })
  readonly meta: CursorPageMetaResource;

  /** 向后兼容别名 */
  get pagination(): CursorPageMetaResource {
    return this.meta;
  }

  constructor(items: T[], pagination: CursorPageMetaResource) {
    this.items = Array.isArray(items) ? items : [];
    this.meta = pagination;
  }
}

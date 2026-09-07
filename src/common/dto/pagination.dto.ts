import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
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

export class PageOptionsRequest extends createZodDto(PageOptionsSchema) {
  get skip(): number {
    return ((this.page ?? PAGINATION.DEFAULT_PAGE) - 1) * this.take;
  }

  get take(): number {
    return this.pageSize ?? PAGINATION.DEFAULT_PER_PAGE;
  }
}

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
  @ApiProperty({ isArray: true })
  readonly items: T[];

  @ApiProperty({ type: PageMetaResource })
  readonly meta: PageMetaResource;

  constructor(items: T[], meta: PageMetaResource) {
    this.items = items;
    this.meta = meta;
  }
}

export const CursorPageOptionsSchema = z.object({
  cursor: z.string().optional().describe('Cursor identifier for pagination'),
  pageSize: PageSizeSchema,
});

export class CursorPageOptionsRequest extends createZodDto(CursorPageOptionsSchema) {
  get take(): number {
    return this.pageSize ?? PAGINATION.DEFAULT_PER_PAGE;
  }
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
  @ApiProperty({ isArray: true })
  readonly items: T[];

  @ApiProperty({ type: CursorPageMetaResource })
  readonly meta: CursorPageMetaResource;

  constructor(items: T[], meta: CursorPageMetaResource) {
    this.items = items;
    this.meta = meta;
  }
}

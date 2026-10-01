/**
 * 分页契约单元测试
 *
 * 覆盖：请求参数 schema 的强制转换与边界、分页输出信封 schema 的结构与白名单裁剪、分页元信息类运算
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CursorPageMetaResource,
  CursorPageOptionsSchema,
  CursorPaginatedResultResource,
  PageMetaResource,
  PageMetaSchema,
  PageOptionsSchema,
  PaginatedResultResource,
  paginatedEnvelopeSchema,
} from '@/common/dto/pagination.dto';

describe('PageOptionsSchema（Offset 分页查询参数）', () => {
  it('查询字符串应强制转换为整数', () => {
    expect(PageOptionsSchema.parse({ page: '2', pageSize: '15' })).toEqual({ page: 2, pageSize: 15 });
  });

  it('缺省字段保持 undefined，由消费方回退默认值', () => {
    expect(PageOptionsSchema.parse({})).toEqual({});
  });

  it('page 小于 1 应被拒绝', () => {
    expect(() => PageOptionsSchema.parse({ page: 0 })).toThrow();
  });

  it('pageSize 超出上限应被拒绝', () => {
    expect(() => PageOptionsSchema.parse({ pageSize: 100_000 })).toThrow();
  });
});

describe('CursorPageOptionsSchema（Cursor 分页查询参数）', () => {
  it('cursor 为可选字符串，pageSize 强制转换', () => {
    expect(CursorPageOptionsSchema.parse({ cursor: 'abc', pageSize: '5' })).toEqual({ cursor: 'abc', pageSize: 5 });
    expect(CursorPageOptionsSchema.parse({})).toEqual({});
  });
});

describe('分页输出信封 schema', () => {
  const PageSchema = paginatedEnvelopeSchema(z.object({ id: z.string() }));

  it('应包含 items 数组与 meta 元数据', () => {
    const parsed = PageSchema.parse({
      items: [{ id: 'a' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.meta.totalPages).toBe(1);
  });

  it('应作为白名单裁剪未声明字段（信封层与 items 层同时生效）', () => {
    const parsed = PageSchema.parse({
      items: [{ id: 'a', password: 'secret' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      extra: true,
    }) as { items: Record<string, unknown>[] } & Record<string, unknown>;

    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.items[0]).not.toHaveProperty('password');
  });

  it('PageMetaSchema 与 PageMetaResource 字段严格一致', () => {
    const meta = new PageMetaResource({ page: 1, pageSize: 20 }, 100);

    expect(PageMetaSchema.parse({ ...meta })).toEqual({ page: 1, pageSize: 20, total: 100, totalPages: 5 });
  });
});

describe('PageMetaResource', () => {
  it('第 1 页共 150 条每页 15 条 — totalPages=10', () => {
    const meta = new PageMetaResource({ page: 1, pageSize: 15 }, 150);
    expect(meta.page).toBe(1);
    expect(meta.pageSize).toBe(15);
    expect(meta.total).toBe(150);
    expect(meta.totalPages).toBe(10);
  });

  it('最后一页 — totalPages=10', () => {
    const meta = new PageMetaResource({ page: 10, pageSize: 15 }, 150);
    expect(meta.page).toBe(10);
    expect(meta.totalPages).toBe(10);
  });

  it('总数为 0 — totalPages=1', () => {
    const meta = new PageMetaResource({ page: 1, pageSize: 15 }, 0);
    expect(meta.total).toBe(0);
    expect(meta.totalPages).toBe(1);
  });

  it('刚好整除 — 第 2 页共 30 条每页 15 条', () => {
    const meta = new PageMetaResource({ page: 2, pageSize: 15 }, 30);
    expect(meta.totalPages).toBe(2);
  });

  it('最后一页不满 — 第 3 页共 35 条每页 15 条', () => {
    const meta = new PageMetaResource({ page: 3, pageSize: 15 }, 35);
    expect(meta.totalPages).toBe(3);
  });

  it('未传入 page/pageSize 时使用默认值', () => {
    const meta = new PageMetaResource({}, 50);
    expect(meta.page).toBe(1);
    expect(meta.pageSize).toBe(20);
    expect(meta.totalPages).toBe(3);
  });
});

describe('CursorPageMetaResource', () => {
  it('构造函数应正确初始化 hasMore, nextCursor, prevCursor', () => {
    const meta = new CursorPageMetaResource({
      hasMore: true,
      nextCursor: 'cur_next_123',
      prevCursor: 'cur_prev_123',
    });

    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).toBe('cur_next_123');
    expect(meta.prevCursor).toBe('cur_prev_123');
  });

  it('默认游标为 null', () => {
    const meta = new CursorPageMetaResource({
      hasMore: false,
    });

    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
    expect(meta.prevCursor).toBeNull();
  });
});

describe('PaginatedResultResource', () => {
  it('应正确封装 items 和 meta', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const meta = new PageMetaResource({ page: 1, pageSize: 2 }, 2);
    const result = new PaginatedResultResource(items, meta);

    expect(result.items).toEqual(items);
    expect(result.meta).toBe(meta);
    expect(result.meta.total).toBe(2);
    expect(result.meta.totalPages).toBe(1);
  });
});

describe('CursorPaginatedResultResource', () => {
  it('应正确封装 items 和 cursor meta', () => {
    const items = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ];
    const meta = new CursorPageMetaResource({
      hasMore: true,
      nextCursor: 'cursor_2',
      prevCursor: null,
    });
    const result = new CursorPaginatedResultResource(items, meta);

    expect(result.items).toEqual(items);
    expect(result.meta).toBe(meta);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBe('cursor_2');
    expect(result.meta.prevCursor).toBeNull();
  });
});

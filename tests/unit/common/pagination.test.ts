/**
 * 分页 DTO 单元测试
 *
 * 覆盖：PageOptionsRequest 跳过/取回计算、PageMetaResource 分页元信息运算
 */
import { describe, expect, it } from 'vitest';
import {
  CursorPageMetaResource,
  CursorPageOptionsRequest,
  CursorPaginatedResultResource,
  PageMetaResource,
  PageOptionsRequest,
  PaginatedResultResource,
} from '@/common/dto/pagination.dto';

describe('PageOptionsRequest', () => {
  describe('skip / take 计算', () => {
    it('默认值：page=1, pageSize=20', () => {
      const opts = new PageOptionsRequest();
      expect(opts.skip).toBe(0);
      expect(opts.take).toBe(20);
    });

    it('第 2 页应跳过 15 条', () => {
      const opts = new PageOptionsRequest();
      opts.page = 2;
      opts.pageSize = 15;
      expect(opts.skip).toBe(15);
      expect(opts.take).toBe(15);
    });

    it('第 3 页每页 20 条应跳过 40 条', () => {
      const opts = new PageOptionsRequest();
      opts.page = 3;
      opts.pageSize = 20;
      expect(opts.skip).toBe(40);
      expect(opts.take).toBe(20);
    });

    it('取 page 为 undefined 时使用默认值 1', () => {
      const opts = new PageOptionsRequest();
      opts.page = undefined;
      opts.pageSize = 10;
      expect(opts.skip).toBe(0);
      expect(opts.take).toBe(10);
    });

    it('取 pageSize 为 undefined 时使用默认值 20', () => {
      const opts = new PageOptionsRequest();
      opts.page = 3;
      opts.pageSize = undefined;
      expect(opts.skip).toBe(40);
      expect(opts.take).toBe(20);
    });
  });
});

describe('CursorPageOptionsRequest', () => {
  it('take 计算：默认每页 20 条', () => {
    const opts = new CursorPageOptionsRequest();
    expect(opts.take).toBe(20);
  });

  it('take 计算：自定义 pageSize', () => {
    const opts = new CursorPageOptionsRequest();
    opts.pageSize = 50;
    expect(opts.take).toBe(50);
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

import { describe, expect, it, vi } from 'vitest';

import { paginateQuery } from '@/database/drizzle/drizzle-pagination';

describe('paginateQuery', () => {
  const createMockDb = (rows: any[] = [{ id: 1 }, { id: 2 }], total = 2) => {
    const offsetMock = vi.fn().mockResolvedValue(rows);
    const limitMock = vi.fn(() => ({ offset: offsetMock }));
    const orderByMock = vi.fn(() => ({ limit: limitMock }));
    const whereMock = vi.fn(() => ({ orderBy: orderByMock, limit: limitMock }));
    const queryState: any = { where: whereMock, orderBy: orderByMock, limit: limitMock };
    queryState.$dynamic = () => queryState;
    const fromMock = vi.fn(() => queryState);
    const selectMock = vi.fn(() => ({ from: fromMock }));
    const countMock = vi.fn().mockResolvedValue(total);

    const db = {
      select: selectMock,
      $count: countMock,
    } as any;

    return { db, selectMock, fromMock, whereMock, orderByMock, limitMock, offsetMock, countMock };
  };

  const mockTable = { _: { name: 'test_table' } } as any;

  it('应使用默认参数并返回标准 rows 与 total', async () => {
    const { db, limitMock, offsetMock, countMock } = createMockDb();

    const result = await paginateQuery(db, mockTable, {});

    expect(limitMock).toHaveBeenCalledWith(20);
    expect(offsetMock).toHaveBeenCalledWith(0);
    expect(countMock).toHaveBeenCalledWith(mockTable);
    expect(result).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 2 });
  });

  it('应支持自定义 page 与 pageSize 计算 offset', async () => {
    const { db, limitMock, offsetMock } = createMockDb();

    await paginateQuery(db, mockTable, { page: 3, pageSize: 20 });

    expect(limitMock).toHaveBeenCalledWith(20);
    expect(offsetMock).toHaveBeenCalledWith(40);
  });

  it('应正确应用 where 条件到查询与计数中', async () => {
    const mockWhere = { condition: true } as any;
    const { db, whereMock, countMock } = createMockDb();

    await paginateQuery(db, mockTable, { where: mockWhere });

    expect(whereMock).toHaveBeenCalledWith(mockWhere);
    expect(countMock).toHaveBeenCalledWith(mockTable, mockWhere);
  });

  it('应正确应用 orderBy 排序规则', async () => {
    const mockOrderBy = { sort: 'desc' } as any;
    const { db, orderByMock } = createMockDb();

    await paginateQuery(db, mockTable, { orderBy: mockOrderBy });

    expect(orderByMock).toHaveBeenCalledWith(mockOrderBy);
  });

  it('未传 columns 时应执行默认全列查询，传入 columns 时应执行列投影', async () => {
    const { db, selectMock } = createMockDb();

    await paginateQuery(db, mockTable, {});
    expect(selectMock).toHaveBeenLastCalledWith();

    const columns = { id: 'col_id', name: 'col_name' };
    await paginateQuery(db, mockTable, { columns: columns as any });
    expect(selectMock).toHaveBeenLastCalledWith(columns);

    await paginateQuery(db, mockTable, { columns: {} as any });
    expect(selectMock).toHaveBeenLastCalledWith();
  });

  it('当 pageSize 超出上限时应自动截断为 100 防御兜底', async () => {
    const { db, limitMock } = createMockDb();

    await paginateQuery(db, mockTable, { page: 1, pageSize: 9999 });

    expect(limitMock).toHaveBeenCalledWith(100);
  });
});

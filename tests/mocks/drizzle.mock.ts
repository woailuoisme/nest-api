/**
 * 共享 Drizzle 客户端与 Mock 工厂
 *
 * 为单测提供直观可控的 Drizzle query、CRUD fluent builder、transaction 与 service mock。
 */
import { vi } from 'vitest';

export function createMockDrizzleDb() {
  const insertReturning = vi.fn();
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const deleteReturning = vi.fn();
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const deleteOp = vi.fn().mockReturnValue({ where: deleteWhere });

  const findFirstUser = vi.fn();
  const findFirstOAuth = vi.fn();
  const execute = vi.fn().mockResolvedValue([]);

  // `limit()` 结果同时支持 `.offset()` 链式调用、`await` 与 Promise 组合子
  const limitResult = {
    offset: vi.fn().mockResolvedValue([]),
    then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve([]).then(onFulfilled, onRejected),
    catch: (onRejected: (error: unknown) => unknown) => Promise.resolve([]).catch(onRejected),
  };

  const mockDb: any = {
    query: {
      user: {
        findFirst: findFirstUser,
      },
      users: {
        findFirst: findFirstUser,
      },
      oauthAccounts: {
        findFirst: findFirstOAuth,
      },
    },
    insert,
    update,
    delete: deleteOp,
    execute,
    $count: vi.fn().mockResolvedValue(0),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue(limitResult),
      }),
    }),
    transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockDb)),
  };

  mockDb._stubs = {
    findFirstUser,
    findFirstOAuth,
    insert,
    insertValues,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    updateReturning,
    deleteOp,
    deleteWhere,
    deleteReturning,
    execute,
  };

  return mockDb;
}

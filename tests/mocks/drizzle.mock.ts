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
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockResolvedValue([]),
        }),
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

export function createMockDrizzleService() {
  const db = createMockDrizzleDb();
  return {
    db,
    _stubs: db._stubs,
  };
}

/** 创建 MailJobs mock */
export function createMockMailQueue(): Record<string, any> {
  return {
    queueVerificationEmail: vi.fn().mockResolvedValue(undefined),
    queuePasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    queueWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  };
}

/** 创建 AuthTokenManager mock */
export function createMockAuthTokenManager(): Record<string, any> {
  return {
    issueTokenPair: vi.fn().mockResolvedValue({ accessToken: 'mock-access', refreshToken: 'mock-refresh' }),
    rotateRefreshToken: vi.fn().mockResolvedValue({ accessToken: 'mock-access-new', refreshToken: 'mock-refresh-new' }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    issueEphemeralToken: vi.fn().mockResolvedValue({
      rawToken: 'mock-raw-token',
      tokenHash: 'mock-token-hash',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    consumeEphemeralToken: vi.fn().mockResolvedValue({ userId: 1 }),
    hashToken: vi.fn((t: string) => `hash:${t}`),
    purgeExpiredTokens: vi.fn().mockResolvedValue(0),
  };
}

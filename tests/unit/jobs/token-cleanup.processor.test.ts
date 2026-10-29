import type { Job } from 'bullmq';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/database/drizzle/database';
import * as schema from '@/database/drizzle/schema';
import { type TokenCleanupJobData, TokenCleanupJobName } from '@/jobs/token-cleanup/token-cleanup.jobs';
import { TokenCleanupProcessor } from '@/jobs/token-cleanup/token-cleanup.processor';

describe('TokenCleanupProcessor', () => {
  let processor: TokenCleanupProcessor;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createMockDrizzleDb();
    mockDb._stubs.deleteReturning.mockResolvedValue([]);
    processor = new TokenCleanupProcessor(mockDb as unknown as Database);
  });

  const makeJob = (): Job<TokenCleanupJobData> =>
    ({ name: TokenCleanupJobName.PurgeExpired, data: { batchSize: 1000 } }) as unknown as Job<TokenCleanupJobData>;

  it('should purge expired sessions, refresh tokens, email tokens and idempotency keys in batches on PurgeExpired job', async () => {
    // 每张表：第一批命中 → 第二批为空（循环结束）
    const selectQueue: { id: string }[][] = [
      [{ id: 'session-1' }, { id: 'session-2' }],
      [],
      [{ id: 'refresh-1' }],
      [],
      [{ id: 'email-1' }],
      [],
      [{ id: 'otp-1' }],
      [],
      [{ id: 'window-target' }],
      [],
      [{ id: 'idempotency-1' }],
      [],
    ];
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }) }),
    }));

    mockDb._stubs.deleteReturning
      .mockResolvedValueOnce([{ id: 'session-1' }, { id: 'session-2' }])
      .mockResolvedValueOnce([{ id: 'refresh-1' }])
      .mockResolvedValueOnce([{ id: 'email-1' }])
      .mockResolvedValueOnce([{ id: 'otp-1' }])
      .mockResolvedValueOnce([{ id: 'ott-1' }])
      .mockResolvedValueOnce([{ id: 'idempotency-1' }]);

    await processor.process(makeJob());

    expect(mockDb.select).toHaveBeenCalledTimes(12);
    expect(mockDb.delete).toHaveBeenCalledTimes(6);
    expect(mockDb.delete).toHaveBeenNthCalledWith(1, schema.sessions);
    expect(mockDb.delete).toHaveBeenNthCalledWith(2, schema.refreshTokens);
    expect(mockDb.delete).toHaveBeenNthCalledWith(3, schema.emailTokens);
    expect(mockDb.delete).toHaveBeenNthCalledWith(4, schema.otpCodes);
    expect(mockDb.delete).toHaveBeenNthCalledWith(5, schema.otpSendWindows);
    expect(mockDb.delete).toHaveBeenNthCalledWith(6, schema.idempotencyKeys);
  });

  it('should stop scanning when no expired rows remain', async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }));

    await processor.process(makeJob());

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should ignore unknown job names without deleting anything', async () => {
    await processor.process({ name: 'unknown-job' } as unknown as Job<TokenCleanupJobData>);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});

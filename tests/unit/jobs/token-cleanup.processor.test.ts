import type { Job } from 'bullmq';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';
import { type TokenCleanupJobData, TokenCleanupJobName } from '@/jobs/token-cleanup/token-cleanup.jobs';
import { TokenCleanupProcessor } from '@/jobs/token-cleanup/token-cleanup.processor';

describe('TokenCleanupProcessor', () => {
  let processor: TokenCleanupProcessor;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createMockDrizzleDb();
    mockDb._stubs.deleteReturning.mockResolvedValue([]);
    processor = new TokenCleanupProcessor(mockDb as unknown as DrizzleDB);
  });

  const makeJob = (): Job<TokenCleanupJobData> =>
    ({ name: TokenCleanupJobName.PurgeExpired, data: { batchSize: 1000 } }) as unknown as Job<TokenCleanupJobData>;

  it('should purge expired sessions and verifications in batches on PurgeExpired job', async () => {
    // 每个表：第一批命中 → 第二批为空（循环结束）
    const selectQueue: { id: string }[][] = [
      [{ id: 'session-1' }, { id: 'session-2' }],
      [],
      [{ id: 'verification-1' }],
      [],
    ];
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }) }),
    }));

    mockDb._stubs.deleteReturning
      .mockResolvedValueOnce([{ id: 'session-1' }, { id: 'session-2' }])
      .mockResolvedValueOnce([{ id: 'verification-1' }]);

    await processor.process(makeJob());

    expect(mockDb.select).toHaveBeenCalledTimes(4);
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
    expect(mockDb.delete).toHaveBeenNthCalledWith(1, schema.session);
    expect(mockDb.delete).toHaveBeenNthCalledWith(2, schema.verification);
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

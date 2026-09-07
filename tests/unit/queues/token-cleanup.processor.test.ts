import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokenManager } from '@/api/client/auth/auth-token.manager';
import { type TokenCleanupJobData, TokenCleanupJobName } from '@/queues/token-cleanup/token-cleanup.jobs';
import { TokenCleanupProcessor } from '@/queues/token-cleanup/token-cleanup.processor';

describe('TokenCleanupProcessor', () => {
  let processor: TokenCleanupProcessor;
  let mockAuthTokenManager: { purgeExpiredTokens: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockAuthTokenManager = {
      purgeExpiredTokens: vi.fn().mockResolvedValue(1002),
    };

    processor = new TokenCleanupProcessor(mockAuthTokenManager as unknown as AuthTokenManager);
  });

  const makeJob = (batchSize = 1000): Job<TokenCleanupJobData> =>
    ({ name: TokenCleanupJobName.PurgeExpired, data: { batchSize } }) as unknown as Job<TokenCleanupJobData>;

  it('should delegate token purging to AuthTokenManager with batchSize', async () => {
    await processor.process(makeJob(500));

    expect(mockAuthTokenManager.purgeExpiredTokens).toHaveBeenCalledWith(500);
  });

  it('should fallback to default batchSize 1000 when data is empty', async () => {
    await processor.process({ name: TokenCleanupJobName.PurgeExpired } as unknown as Job<TokenCleanupJobData>);

    expect(mockAuthTokenManager.purgeExpiredTokens).toHaveBeenCalledWith(1000);
  });

  it('should ignore unknown job names without touching AuthTokenManager', async () => {
    await processor.process({ name: 'unknown-job' } as unknown as Job<TokenCleanupJobData>);

    expect(mockAuthTokenManager.purgeExpiredTokens).not.toHaveBeenCalled();
  });
});

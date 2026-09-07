import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuthTokenManager } from '@/api/client/auth/auth-token.manager';
import { TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import { type TokenCleanupJobData, TokenCleanupJobName } from './token-cleanup.jobs';

/**
 * Token 清理消费者 — 消费定时任务，批量删除过期/已用的 token 记录。
 * 委托 AuthTokenManager 执行分批删除，防止长事务锁表。
 */
@Injectable()
@Processor(TOKEN_CLEANUP_QUEUE)
export class TokenCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenCleanupProcessor.name);

  constructor(private readonly authTokenManager: AuthTokenManager) {
    super();
  }

  async process(job: Job<TokenCleanupJobData>): Promise<void> {
    switch (job.name) {
      case TokenCleanupJobName.PurgeExpired: {
        const batchSize = job.data?.batchSize ?? 1000;
        const totalDeleted = await this.authTokenManager.purgeExpiredTokens(batchSize);
        if (totalDeleted > 0) {
          this.logger.log(`Token cleanup complete: ${totalDeleted} records deleted`);
        }
        break;
      }
      default:
        this.logger.warn(`Unknown token cleanup job: ${job.name}`);
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { lt } from 'drizzle-orm';
import { TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';
import { type TokenCleanupJobData, TokenCleanupJobName } from './token-cleanup.jobs';

/**
 * 会话与令牌清理消费者 — 消费定时任务，批量清理过期 Better Auth 会话与验证码记录。
 */
@Injectable()
@Processor(TOKEN_CLEANUP_QUEUE)
export class TokenCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenCleanupProcessor.name);

  constructor(@InjectDb() private readonly db: DrizzleDB) {
    super();
  }

  async process(job: Job<TokenCleanupJobData>): Promise<void> {
    switch (job.name) {
      case TokenCleanupJobName.PurgeExpired: {
        const now = new Date();
        const deletedSessions = await this.db
          .delete(schema.session)
          .where(lt(schema.session.expiresAt, now))
          .returning({ id: schema.session.id });

        const deletedVerifications = await this.db
          .delete(schema.verification)
          .where(lt(schema.verification.expiresAt, now))
          .returning({ id: schema.verification.id });

        const totalDeleted = (deletedSessions?.length ?? 0) + (deletedVerifications?.length ?? 0);
        if (totalDeleted > 0) {
          this.logger.log(
            `Session/token cleanup complete: ${deletedSessions.length} sessions and ${deletedVerifications.length} verifications purged`,
          );
        }
        break;
      }
      default:
        this.logger.warn(`Unknown token cleanup job: ${job.name}`);
    }
  }
}

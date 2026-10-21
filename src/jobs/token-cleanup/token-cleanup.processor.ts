import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { inArray, lt } from 'drizzle-orm';

import { TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';

import { type TokenCleanupJobData, TokenCleanupJobName } from './token-cleanup.jobs';

/** 默认批量删除行数（来自调度声明，可由 job.data 覆盖） */
const DEFAULT_BATCH_SIZE = 1_000;

/** 单次任务最多执行的批次数：防止异常数据导致任务无限循环并超出 BullMQ 锁时长 */
const MAX_BATCHES = 1_000;

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
        const batchSize = this.resolveBatchSize(job.data?.batchSize);

        // 分批删除而非单条无界 DELETE：
        // 首次清理面对百万级过期行时，单条语句会成为长事务 —— WAL 暴涨、表膨胀、
        // 锁住热表 session 并让任务超出 BullMQ 锁时长而被并发重跑。
        const deletedSessions = await this.purgeInBatches(
          (ids) =>
            this.db.delete(schema.session).where(inArray(schema.session.id, ids)).returning({ id: schema.session.id }),
          () =>
            this.db
              .select({ id: schema.session.id })
              .from(schema.session)
              .where(lt(schema.session.expiresAt, now))
              .limit(batchSize),
        );

        const deletedVerifications = await this.purgeInBatches(
          (ids) =>
            this.db
              .delete(schema.verification)
              .where(inArray(schema.verification.id, ids))
              .returning({ id: schema.verification.id }),
          () =>
            this.db
              .select({ id: schema.verification.id })
              .from(schema.verification)
              .where(lt(schema.verification.expiresAt, now))
              .limit(batchSize),
        );

        if (deletedSessions > 0 || deletedVerifications > 0) {
          this.logger.log(
            `Session/token cleanup complete: ${deletedSessions} sessions and ${deletedVerifications} verifications purged (batchSize=${batchSize})`,
          );
        }
        break;
      }
      default:
        this.logger.warn(`Unknown token cleanup job: ${job.name}`);
    }
  }

  /** 校验批量大小：非法值回退默认值，避免 0/负数造成死循环或空转 */
  private resolveBatchSize(value?: number): number {
    return Number.isInteger(value) && value && value > 0 ? value : DEFAULT_BATCH_SIZE;
  }

  /**
   * 按批删除直到无命中：每轮先取一批过期主键再定向删除，单事务规模恒定。
   */
  private async purgeInBatches(
    removeByIds: (ids: string[]) => Promise<{ id: string }[]>,
    selectExpiredIds: () => Promise<{ id: string }[]>,
  ): Promise<number> {
    let total = 0;

    for (let round = 0; round < MAX_BATCHES; round += 1) {
      const expired = await selectExpiredIds();
      if (expired.length === 0) break;

      const deleted = await removeByIds(expired.map((row) => row.id));
      total += deleted.length;

      // 已选中的行被并发删除时不计数，也不再继续空转
      if (deleted.length === 0) break;
    }

    return total;
  }
}

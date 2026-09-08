import { createHash } from 'node:crypto';
import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { idempotencyKeys } from '@/database/drizzle/schema/idempotency.schema';

export interface AcquireIdempotencyParams {
  key: string;
  requestPath: string;
  requestMethod: string;
  actorType: string;
  userId: string | null;
  payloadHash: string;
  ttlSeconds?: number;
}

export interface CachedResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string> | null;
}

export type AcquireResult = { acquired: true; recordId: number } | { acquired: false; cached: CachedResponse };

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@InjectDb() private readonly db: DrizzleDB) {}

  /** 计算请求体 SHA-256 签名哈希 */
  computePayloadHash(payload: unknown): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * 基于数据库唯一索引原子认领幂等锁：
   * 1. 插入 started 记录；
   * 2. 冲突时校验 SHA-256 载荷（不符抛 422）；
   * 3. 校验执行中状态（进行中抛 409 退避）；
   * 4. 已完成直接返回缓存响应回放。
   */
  async acquire(params: AcquireIdempotencyParams): Promise<AcquireResult> {
    const { key, requestPath, requestMethod, actorType, userId, payloadHash, ttlSeconds = 86400 } = params;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      const [inserted] = await this.db
        .insert(idempotencyKeys)
        .values({
          key,
          requestPath,
          requestMethod,
          actorType,
          userId,
          requestParamsHash: payloadHash,
          status: 'started',
          lockedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return { acquired: true, recordId: inserted.id };
    } catch (err: unknown) {
      const pgErr = err as { code?: string; cause?: { code?: string } };
      const code = pgErr.code ?? pgErr.cause?.code;
      if (code === '23505') {
        return this.handleConflict(key, requestPath, actorType, userId, payloadHash, expiresAt);
      }
      throw err;
    }
  }

  /**
   * 标记幂等执行成功并持久化响应，供后续重放
   */
  async complete(
    recordId: number,
    responseStatusCode: number,
    responseBody: unknown,
    responseHeaders: Record<string, string> = {},
  ): Promise<void> {
    try {
      await this.db
        .update(idempotencyKeys)
        .set({
          status: 'completed',
          responseStatusCode,
          responseBody,
          responseHeaders,
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeys.id, recordId));
    } catch (error) {
      this.logger.warn(`Failed to persist idempotency completion for record ${recordId}: ${String(error)}`);
    }
  }

  /**
   * 标记幂等执行失败并释放占位锁
   */
  async fail(recordId: number): Promise<void> {
    try {
      await this.db
        .update(idempotencyKeys)
        .set({
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(idempotencyKeys.id, recordId));
    } catch (error) {
      this.logger.warn(`Failed to mark idempotency failure for record ${recordId}: ${String(error)}`);
    }
  }

  private async handleConflict(
    key: string,
    requestPath: string,
    actorType: string,
    userId: string | null,
    payloadHash: string,
    newExpiresAt: Date,
  ): Promise<AcquireResult> {
    const conditions = [
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.requestPath, requestPath),
      eq(idempotencyKeys.actorType, actorType),
      userId ? eq(idempotencyKeys.userId, userId) : isNull(idempotencyKeys.userId),
    ];

    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(...conditions));

    if (!existing) {
      throw new ConflictException('Concurrent idempotency reservation conflict');
    }

    // 1. 检查记录是否已过期，过期则允许重新认领
    if (existing.expiresAt.getTime() <= Date.now()) {
      return this.restartIdempotencyRecord(existing.id, payloadHash, newExpiresAt);
    }

    // 2. 严格校验 Payload SHA-256 哈希（防篡改反模式，API.md 3.3.3）
    if (existing.requestParamsHash !== payloadHash) {
      throw new UnprocessableEntityException('Idempotency key payload mismatch');
    }

    // 3. 正在处理中的重试，返回 409 Conflict 提示退避（API.md 3.3.4）
    if (existing.status === 'started' || existing.status === 'in_progress') {
      throw new ConflictException(
        'A previous request with the same Idempotency-Key is currently in progress. Please retry after a backoff.',
      );
    }

    // 4. 已完成的请求，提取已缓存响应并回放
    if (existing.status === 'completed') {
      return {
        acquired: false,
        cached: {
          statusCode: existing.responseStatusCode ?? 200,
          body: existing.responseBody,
          headers: existing.responseHeaders,
        },
      };
    }

    // 5. 既有记录为 failed 时，允许重试
    return this.restartIdempotencyRecord(existing.id, payloadHash, newExpiresAt);
  }

  /** 重启或重试认领幂等记录（过期或失败重试） */
  private async restartIdempotencyRecord(id: number, payloadHash: string, expiresAt: Date): Promise<AcquireResult> {
    const now = new Date();
    await this.db
      .update(idempotencyKeys)
      .set({
        requestParamsHash: payloadHash,
        status: 'started',
        lockedAt: now,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(idempotencyKeys.id, id));

    return { acquired: true, recordId: id };
  }
}

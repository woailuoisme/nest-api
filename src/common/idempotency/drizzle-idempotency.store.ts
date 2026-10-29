import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { IdempotencyAcquireResult, IdempotencyStore, IdempotencyStoredPayload } from '@nestjs/idempotency';
import { IdempotencyStorage } from '@nestjs/idempotency';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import type { Database } from '@/database/drizzle/database';
import { idempotencyKeys } from '@/database/drizzle/schema/idempotency.schema';

/** 数据库侧当前毫秒时间戳：租约可见性判定统一走 DB 时钟 */
const NOW_MS_SQL = sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint`;

/**
 * 租约截止时间（毫秒）—— 由数据库时钟推导
 *
 * 写入与判定必须同源同为 DB 时钟：多副本间 NTP 漂移会让某副本提前认为他人租约
 * 已过期，在 TTL 未满时抢占，等价于静默缩短租约。
 */
function leaseDeadlineSql(ttlMs: number) {
  return sql`(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint + ${ttlMs}`;
}

/**
 * 生产级 Drizzle + PostgreSQL 幂等存储驱动 (DrizzleIdempotencyStore)
 *
 * 遵循 @nestjs/idempotency 官方 IdempotencyStore 规范：
 * 1. 原子认领 (acquire)：单条 PostgreSQL `INSERT ... ON CONFLICT (key_hash) DO UPDATE ... WHERE expires_at <= $now` 语句，
 *    消除读-写间隙并发竞争，确保多副本/高并发下有且仅有一个请求能成功抢占租约；
 * 2. 状态存储 (complete)：单语句 CAS 更新 `UPDATE ... WHERE key_hash = $key AND owner = $owner AND expires_at > $now`，
 *    持久化响应负载并撤销 owner 租约标记；
 * 3. 锁释放 (release)：单语句 CAS 删除 `DELETE ... WHERE key_hash = $key AND owner = $owner AND expires_at > $now`，
 *    仅释放未完成的处理中锁，严禁误删已持久化的完成态回放记录；
 * 4. 心跳续租 (extend)：单语句 CAS 延期 `UPDATE ... WHERE key_hash = $key AND owner = $owner AND expires_at > $now`，
 *    防止慢请求与长事务并发租约失效导致重入。
 */
@Injectable()
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    storage: IdempotencyStorage,
  ) {
    // 官方契约：单例 provider 的构造器内无条件注册；装配错误应在启动期失败而不是静默回落到内存 store
    storage.registerSource(this);
  }

  /**
   * 将任意 Unicode 格式且长度各异的 Key 规整为 SHA-256 哈希值作为数据库主键
   */
  hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * 原子抢占租约锁或检索已完成的幂等记录
   *
   * `attempt` 为内部重试预算：单次调用只允许因“读到已过期/已释放的行”重试一次，
   * 无限递归在并发重试风暴下会堆叠数据库往返直至栈溢出（把可恢复的 409 打成 5xx）。
   */
  async acquire(
    key: string,
    owner: string,
    fingerprint: string,
    lockTtl: number,
    attempt = 0,
  ): Promise<IdempotencyAcquireResult> {
    const keyHash = this.hashKey(key);

    // 单条原子 UPSERT 语句：新 Key 直接写入，过期 Key 自动重置并抢占
    const acquiredRows = await this.db
      .insert(idempotencyKeys)
      .values({
        keyHash,
        key,
        fingerprint,
        owner,
        response: null,
        expiresAt: leaseDeadlineSql(lockTtl),
        updatedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: idempotencyKeys.keyHash,
        set: {
          owner,
          fingerprint,
          response: null,
          expiresAt: leaseDeadlineSql(lockTtl),
          updatedAt: sql`NOW()`,
        },
        setWhere: lte(idempotencyKeys.expiresAt, NOW_MS_SQL),
      })
      .returning();

    if (acquiredRows.length > 0) {
      return { state: 'acquired' };
    }

    // 冲突：回查现有租约或已持久化响应。
    // 过期判定交给 DB 时钟（extras）：既避免用本机时钟判断他人租约，也避免把
    // 「已过期但本次 UPSERT 未命中」的行误报为 in-flight（会让上层白等 waitTimeout 后 409）。
    const existing = await this.db.query.idempotencyKeys.findFirst({
      where: { keyHash },
      extras: {
        // v1 关系查询会为表起别名，必须用回调拿到别名后的列引用
        expired: (table) => sql<boolean>`${table.expiresAt} <= ${NOW_MS_SQL}`,
      },
    });

    if (!existing || existing.expired) {
      // 租约此刻已失效（被并发释放或已过期）：重试一次 UPSERT；预算耗尽则上抛，交由上层 fail-closed 处理
      if (attempt >= 1) {
        throw new Error(`Idempotency acquire retry exhausted under contention for key hash ${keyHash}`);
      }
      return this.acquire(key, owner, fingerprint, lockTtl, attempt + 1);
    }

    if (existing.owner !== null) {
      return {
        state: 'in-flight',
        fingerprint: existing.fingerprint,
      };
    }

    return {
      state: 'completed',
      fingerprint: existing.fingerprint,
      response: existing.response as IdempotencyStoredPayload,
    };
  }

  /**
   * 完成请求处理：持久化响应体并释放租约 Fencing Token
   */
  async complete(key: string, owner: string, response: IdempotencyStoredPayload, ttl: number): Promise<boolean> {
    const keyHash = this.hashKey(key);

    const result = await this.db
      .update(idempotencyKeys)
      .set({
        owner: null,
        response,
        expiresAt: leaseDeadlineSql(ttl),
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(idempotencyKeys.keyHash, keyHash),
          eq(idempotencyKeys.owner, owner),
          gt(idempotencyKeys.expiresAt, NOW_MS_SQL),
        ),
      )
      .returning({ keyHash: idempotencyKeys.keyHash });

    return result.length > 0;
  }

  /**
   * 业务失败或取消：安全释放持有中的排他锁
   */
  async release(key: string, owner: string): Promise<boolean> {
    const keyHash = this.hashKey(key);

    const result = await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.keyHash, keyHash),
          eq(idempotencyKeys.owner, owner),
          gt(idempotencyKeys.expiresAt, NOW_MS_SQL),
        ),
      )
      .returning({ keyHash: idempotencyKeys.keyHash });

    return result.length > 0;
  }

  /**
   * 心跳续租：延长持有中排他锁的过期时间
   */
  async extend(key: string, owner: string, lockTtl: number): Promise<boolean> {
    const keyHash = this.hashKey(key);

    const result = await this.db
      .update(idempotencyKeys)
      .set({
        expiresAt: leaseDeadlineSql(lockTtl),
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(idempotencyKeys.keyHash, keyHash),
          eq(idempotencyKeys.owner, owner),
          gt(idempotencyKeys.expiresAt, NOW_MS_SQL),
        ),
      )
      .returning({ keyHash: idempotencyKeys.keyHash });

    return result.length > 0;
  }
}

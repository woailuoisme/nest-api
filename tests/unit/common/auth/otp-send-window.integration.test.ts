/**
 * 真实 PostgreSQL 集成测试：OTP 发送窗口（每小时上限）的原子语义。
 *
 * 为什么必须有这一层：单测把 drizzle builder 整体 mock，只能验证「调用了哪个方法」。
 * 旧实现用 `otp_codes.created_at` 统计每小时次数，因唯一约束 + upsert 重置 `created_at`，
 * 计数恒为 0/1 —— 单元测试用 mock 的 `$count` 掩盖了这一点，导致「每小时 5 次」长期失效。
 * 本文件直接驱动真实 SQL，覆盖：冷却拒绝、窗口内累计、第 6 次拒绝、窗口过期后重新计数。
 *
 * 目标库取自 `DB_URL`；**库不可达或 otp_send_windows 尚未迁移时整体跳过**，可安全留在默认单测集。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { HttpException } from '@nestjs/common';
import { parse } from 'dotenv';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OtpService } from '@/common/auth/otp.service';
import { createDatabase, type Database } from '@/database/drizzle/database';
import { createPgPool } from '@/database/drizzle/pg';
import * as schema from '@/database/drizzle/schema';

const envFile = existsSync('.env') ? parse(readFileSync('.env')) : {};
const DB_URL = process.env.DB_URL ?? envFile.DB_URL ?? 'postgresql://postgres:postgres@localhost:5432/nest-api';

type Connection = { client: Pool; db: Database };

/** 探测真实 PostgreSQL 且确认 otp_send_windows 已迁移；任一不满足返回 null（用例整体跳过） */
async function connectDb(): Promise<Connection | null> {
  const client = createPgPool(DB_URL, { max: 1, idleTimeoutMillis: 2000, connectionTimeoutMillis: 2000 });
  try {
    await client.query('SELECT 1 FROM otp_send_windows LIMIT 1');
    return { client, db: createDatabase(client) };
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

const connection = await connectDb();

/** 取 429 响应体（含机器可读 code） */
async function rejectionBody(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(429);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe.skipIf(!connection)('OtpService 发送窗口（真实 PostgreSQL）', () => {
  /** 每个用例独立 target，互不干扰 */
  const targetFor = (name: string) => `itest-${name}-${randomUUID()}@example.com`;
  let service: OtpService;
  let currentTarget: string;

  beforeAll(() => {
    if (!connection) return;
    // 邮件入队只做占位：本文件验证的是限流 SQL，不关心投递实现
    service = new OtpService(connection.db, { queueEmailOtp: async () => {} } as never);
  });

  afterAll(async () => {
    if (!connection) return;
    for (const table of [schema.otpCodes, schema.otpSendWindows]) {
      await connection.db.delete(table).where(sql`${table.target} like ${'itest-%'}`);
    }
    await connection.client.end().catch(() => {});
  });

  /** 绕过冷却：把上次发送时间回拨 61 秒（模拟用户等待后重发） */
  async function passCooldown(): Promise<void> {
    await connection!.db.execute(
      sql`update otp_send_windows set last_sent_at = last_sent_at - interval '61 seconds' where target = ${currentTarget}`,
    );
  }

  it('冷却期内第二次发送应被 429 拒绝（OTP_SEND_TOO_FREQUENT）', async () => {
    currentTarget = targetFor('cooldown');

    await service.sendEmailCode({ userId: 'u1', email: currentTarget });

    const body = await rejectionBody(service.sendEmailCode({ userId: 'u1', email: currentTarget }));
    expect(body).toMatchObject({ code: 'OTP_SEND_TOO_FREQUENT' });
  });

  it('窗口内可发送 5 次，第 6 次应被 429 拒绝（OTP_SEND_HOURLY_LIMIT）', async () => {
    currentTarget = targetFor('hourly');

    for (let i = 1; i <= 5; i += 1) {
      await service.sendEmailCode({ userId: 'u1', email: currentTarget });
      await passCooldown();
    }

    const body = await rejectionBody(service.sendEmailCode({ userId: 'u1', email: currentTarget }));
    expect(body).toMatchObject({ code: 'OTP_SEND_HOURLY_LIMIT' });

    const [window] = await connection!.db
      .select()
      .from(schema.otpSendWindows)
      .where(sql`${schema.otpSendWindows.target} = ${currentTarget}`);
    // 被拒的请求不得消耗配额
    expect(window?.sendCount).toBe(5);
  });

  it('窗口过期后应重新计数（send_count 重置为 1）', async () => {
    currentTarget = targetFor('reset');

    await service.sendEmailCode({ userId: 'u1', email: currentTarget });
    await passCooldown();
    await service.sendEmailCode({ userId: 'u1', email: currentTarget });

    await connection!.db.execute(
      sql`update otp_send_windows
             set window_started_at = window_started_at - interval '2 hours',
                 last_sent_at = last_sent_at - interval '2 hours'
           where target = ${currentTarget}`,
    );

    await service.sendEmailCode({ userId: 'u1', email: currentTarget });

    const [window] = await connection!.db
      .select()
      .from(schema.otpSendWindows)
      .where(sql`${schema.otpSendWindows.target} = ${currentTarget}`);
    expect(window?.sendCount).toBe(1);
  });
});

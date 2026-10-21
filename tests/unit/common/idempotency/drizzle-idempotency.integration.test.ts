/**
 * DrizzleIdempotencyStore 真实 PostgreSQL 集成测试
 *
 * 单元测试把 Drizzle fluent builder 整体 mock 掉，只能验证「调用了哪个方法」，
 * 无法验证租约的原子抢占、CAS 谓词与 DB 时钟语义。本文件直接驱动真实实现与真实 SQL，覆盖：
 * 新键抢占、在途互斥、完成后回放、CAS 失配、**过期行必须被接管**、释放后可重新抢占。
 *
 * 目标库取自 `DB_URL`（缺失时回退本机默认地址）；**库不可达或 idempotency_keys 表尚未迁移时整体跳过**，
 * 可安全留在默认单元测试集。读取 `.env` 使用 `dotenv.parse` 而非 `dotenv/config`：不修改 `process.env`。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { parse } from 'dotenv';
import { like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleIdempotencyStore } from '@/common/idempotency/drizzle-idempotency.store';
import * as schema from '@/database/drizzle/schema';

const envFile = existsSync('.env') ? parse(readFileSync('.env')) : {};
const DB_URL = process.env.DB_URL ?? envFile.DB_URL ?? 'postgresql://postgres:postgres@localhost:5432/nest-api';

type Connection = {
  client: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
};

/** 探测真实 PostgreSQL 且确认幂等表已迁移；任一不满足返回 null（用例整体跳过） */
async function connectDb(): Promise<Connection | null> {
  const client = postgres(DB_URL, { max: 1, connect_timeout: 2, idle_timeout: 2, onnotice: () => {} });
  try {
    await client`SELECT 1 FROM idempotency_keys LIMIT 1`;
    return { client, db: drizzle(client, { schema }) };
  } catch {
    await client.end({ timeout: 1 }).catch(() => {});
    return null;
  }
}

const connection = await connectDb();

describe.skipIf(!connection)('DrizzleIdempotencyStore（真实 PostgreSQL 集成）', () => {
  const keyPrefix = `itest-${randomUUID()}-`;
  let store: DrizzleIdempotencyStore;

  beforeAll(() => {
    if (!connection) return;
    store = new DrizzleIdempotencyStore(connection.db);
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.db.delete(schema.idempotencyKeys).where(like(schema.idempotencyKeys.key, `${keyPrefix}%`));
    await connection.client.end({ timeout: 5 }).catch(() => {});
  });

  /** 每个用例使用独立键名，避免相互干扰 */
  const newKey = (caseName: string) => `${keyPrefix}${caseName}`;

  it('新键首次抢占成功，同一键在未过期时第二次请求被判为在途', async () => {
    const key = newKey('acquire');

    const first = await store.acquire(key, 'owner-1', '/v1/orders:hash-a', 30_000);
    expect(first.state).toBe('acquired');

    const second = await store.acquire(key, 'owner-2', '/v1/orders:hash-a', 30_000);
    expect(second).toEqual({ state: 'in-flight', fingerprint: '/v1/orders:hash-a' });
  });

  it('已完成记录应回放持久化的状态码与响应体', async () => {
    const key = newKey('complete');

    await store.acquire(key, 'owner-1', '/v1/orders:hash-b', 30_000);
    const persisted = await store.complete(key, 'owner-1', { status: 201, headers: {}, body: { id: 'ord-1' } }, 60_000);
    expect(persisted).toBe(true);

    const replay = await store.acquire(key, 'owner-2', '/v1/orders:hash-b', 30_000);
    expect(replay.state).toBe('completed');
    if (replay.state === 'completed') {
      expect(replay.response).toEqual({ status: 201, headers: {}, body: { id: 'ord-1' } });
    }
  });

  it('CAS 校验：owner 不匹配时 complete / release 均返回 false 且不破坏既有租约', async () => {
    const key = newKey('cas');

    await store.acquire(key, 'owner-1', '/v1/orders:hash-c', 30_000);

    await expect(store.complete(key, 'owner-hijack', { status: 200, headers: {}, body: {} }, 60_000)).resolves.toBe(
      false,
    );
    await expect(store.release(key, 'owner-hijack')).resolves.toBe(false);

    // 原租约仍然有效
    const stillMine = await store.acquire(key, 'owner-2', '/v1/orders:hash-c', 30_000);
    expect(stillMine.state).toBe('in-flight');
  });

  it('已过期记录必须被接管为 acquired（租约可见性由 DB 时钟判定，不受进程时钟影响）', async () => {
    const key = newKey('expired');
    const keyHash = store.hashKey(key);

    // 直接写入一条 1 分钟前过期的租约，模拟崩溃残留
    await connection!.db.insert(schema.idempotencyKeys).values({
      keyHash,
      key,
      fingerprint: '/v1/orders:hash-d',
      owner: 'dead-owner',
      response: null,
      expiresAt: Date.now() - 60_000,
      updatedAt: new Date(),
    });

    const takenOver = await store.acquire(key, 'owner-new', '/v1/orders:hash-d', 30_000);
    expect(takenOver.state).toBe('acquired');
  });

  it('release 成功后可重新抢占，且不会误删已完成的回放记录', async () => {
    const released = newKey('release');
    await store.acquire(released, 'owner-1', '/v1/orders:hash-e', 30_000);
    await expect(store.release(released, 'owner-1')).resolves.toBe(true);
    await expect(store.acquire(released, 'owner-2', '/v1/orders:hash-e', 30_000)).resolves.toEqual({
      state: 'acquired',
    });

    const completed = newKey('release-completed');
    await store.acquire(completed, 'owner-1', '/v1/orders:hash-f', 30_000);
    await store.complete(completed, 'owner-1', { status: 200, headers: {}, body: {} }, 60_000);
    await expect(store.release(completed, 'owner-1')).resolves.toBe(false);
    await expect(store.acquire(completed, 'owner-2', '/v1/orders:hash-f', 30_000)).resolves.toMatchObject({
      state: 'completed',
    });
  });
});

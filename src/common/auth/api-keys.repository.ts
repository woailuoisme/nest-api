import type { ApiKeyRecord } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq } from 'drizzle-orm';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { Database } from '@/database/drizzle/database';
import { apiKeys, user } from '@/database/drizzle/schema';

import { toAuthUser } from './user';

export interface StoredApiKey {
  id: string;
  userId: string;
  name: string | null;
  prefix: string;
  hash: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revoked: boolean;
}

@Injectable()
export class ApiKeysRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** 供 ApiKeyProvider 在每次 Bearer 请求中查表 */
  async findWithUser(id: string): Promise<ApiKeyRecord<CurrentUserPayload> | null> {
    const [row] = await this.db
      .select({ apiKey: apiKeys, user })
      .from(apiKeys)
      .innerJoin(user, eq(user.id, apiKeys.userId))
      .where(and(eq(apiKeys.id, id), eq(apiKeys.revoked, false)))
      .limit(1);

    if (!row) {
      return null;
    }
    const owner = toAuthUser(row.user);
    if (owner.banned) {
      return null;
    }
    return { hash: row.apiKey.hash, user: owner, expiresAt: row.apiKey.expiresAt };
  }

  async create(record: StoredApiKey): Promise<void> {
    await this.db.insert(apiKeys).values(record);
  }

  async listByUser(userId: string): Promise<StoredApiKey[]> {
    return this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.revoked, false)))
      .orderBy(desc(apiKeys.createdAt));
  }

  /** 吊销用户全部有效 Key（密码重置 / 全端退出时调用） */
  async revokeAll(userId: string): Promise<number> {
    const rows = await this.db
      .update(apiKeys)
      .set({ revoked: true })
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.revoked, false)))
      .returning({ id: apiKeys.id });
    return rows.length;
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(apiKeys)
      .set({ revoked: true })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id });
    return rows.length === 1;
  }
}

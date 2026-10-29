import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, type SQL } from 'drizzle-orm';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { Database } from '@/database/drizzle/database';
import { account, user } from '@/database/drizzle/schema';

import { normalizeEmail } from './email.util';
import { toAuthUser } from './user';

export interface UserCredentials {
  user: CurrentUserPayload;
  passwordHash: string | null;
}

/**
 * 用户与凭据读取层：`@nestjs/authentication` 只认普通 User 对象，
 * 密码哈希始终留在本层，不外泄到控制器、日志或响应。
 */
@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findById(id: string): Promise<CurrentUserPayload | null> {
    return this.findOneBy(eq(user.id, id));
  }

  async findByEmail(email: string): Promise<CurrentUserPayload | null> {
    return this.findOneBy(eq(user.email, normalizeEmail(email)));
  }

  async findByPhone(phoneNumber: string): Promise<CurrentUserPayload | null> {
    return this.findOneBy(eq(user.phoneNumber, phoneNumber));
  }

  /** 单行查询 + 行 → 认证用户映射（三个 finder 共用） */
  private async findOneBy(condition: SQL): Promise<CurrentUserPayload | null> {
    const [row] = await this.db.select().from(user).where(condition).limit(1);
    return row ? toAuthUser(row) : null;
  }

  /** 仅密码登录使用：返回用户与其 credential 账户上的密码哈希 */
  async findCredentials(email: string): Promise<UserCredentials | null> {
    const [row] = await this.db
      .select({ user, passwordHash: account.password })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .where(eq(user.email, normalizeEmail(email)))
      .limit(1);

    return row ? { user: toAuthUser(row.user), passwordHash: row.passwordHash } : null;
  }

  async create(
    email: string,
    {
      passwordHash,
      name,
      emailVerified = false,
    }: {
      passwordHash?: string | null;
      name?: string;
      emailVerified?: boolean;
    } = {},
  ): Promise<CurrentUserPayload> {
    const normalizedEmail = normalizeEmail(email);
    const now = new Date();
    const id = randomUUID();
    const displayName = name?.trim() || normalizedEmail.split('@')[0] || normalizedEmail;

    const [row] = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(user)
        .values({
          id,
          name: displayName,
          email: normalizedEmail,
          emailVerified,
          role: Role.USER,
          banned: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (passwordHash) {
        await tx.insert(account).values({
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          userId: id,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        });
      }

      return [created];
    });

    return toAuthUser(row);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
  }

  /** 改邮箱即视为未验证：任何旧链接都会因地址不匹配而失效 */
  async updateEmail(userId: string, email: string): Promise<CurrentUserPayload | null> {
    const [row] = await this.db
      .update(user)
      .set({ email: normalizeEmail(email), emailVerified: false, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning();
    return row ? toAuthUser(row) : null;
  }

  /** 绑定手机号并标记已验证（调用方负责归一化号码格式） */
  async setPhoneNumber(userId: string, phoneNumber: string): Promise<CurrentUserPayload | null> {
    const [row] = await this.db
      .update(user)
      .set({ phoneNumber, phoneNumberVerified: true, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning();
    return row ? toAuthUser(row) : null;
  }

  /** 仅当链接寄往的地址仍是用户当前地址时才标记验证成功 */
  async markEmailVerified(userId: string, email: string): Promise<boolean> {
    const rows = await this.db
      .update(user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(and(eq(user.id, userId), eq(user.email, normalizeEmail(email))))
      .returning({ id: user.id });
    return rows.length === 1;
  }
}

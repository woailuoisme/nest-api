import { faker } from '@faker-js/faker';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { chunk } from 'es-toolkit';
import { v7 as uuidv7 } from 'uuid';

import { Role } from '@/common/constants/roles';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';

export const description = 'Seed users with faker — 1 demo user + random users';

/** 随机种子：固定值保证每次运行生成相同数据 */
const FAKER_SEED = 42;
/** 生成的随机用户数量 */
const RANDOM_USER_COUNT = 100;
/** 所有随机用户的通用密码 */
const DEFAULT_PASSWORD = 'password123';

/** 固定测试账号 — 始终可登录 */
const DEMO_USER = {
  name: 'Demo User',
  email: 'user@nestforge.dev',
  password: 'password123',
  role: Role.USER,
} as const;

/**
 * 角色权重分布 — 模拟真实团队比例
 * OPERATOR 10% / USER 90%
 */
const ROLE_POOL: Role[] = [...Array<Role>(2).fill(Role.OPERATOR), ...Array<Role>(18).fill(Role.USER)];

/** 插入固定测试账号 */
async function seedFixedUser(db: DrizzleDB): Promise<void> {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, DEMO_USER.email),
  });

  if (!existing) {
    const userId = uuidv7();
    const passwordHash = await hashPassword(DEMO_USER.password);

    await db.transaction(async (tx) => {
      await tx.insert(schema.user).values({
        id: userId,
        name: DEMO_USER.name,
        email: DEMO_USER.email,
        emailVerified: true,
        role: DEMO_USER.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx.insert(schema.account).values({
        id: uuidv7(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }

  console.log(`  [1/${RANDOM_USER_COUNT + 1}] ${DEMO_USER.email} / ${DEMO_USER.password} (${DEMO_USER.role})`);
}

/** 使用 faker 批量生成随机用户（基于 es-toolkit chunk 分批落库） */
async function seedRandomUsers(db: DrizzleDB): Promise<void> {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const usersToInsert: (typeof schema.user.$inferInsert)[] = [];
  const accountsToInsert: (typeof schema.account.$inferInsert)[] = [];

  for (let i = 0; i < RANDOM_USER_COUNT; i++) {
    const userId = uuidv7();
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const name = `${firstName} ${lastName}`;
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();
    const role = faker.helpers.arrayElement(ROLE_POOL);
    const image = faker.image.avatarGitHub();

    // 70% 概率已验证邮箱
    const emailVerified = faker.number.int({ min: 1, max: 10 }) <= 7;

    usersToInsert.push({
      id: userId,
      name,
      email,
      role,
      emailVerified,
      image,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    accountsToInsert.push({
      id: uuidv7(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 使用 es-toolkit chunk 将 100 条数据拆分为 4 个 batch 批量插入
  const userBatches = chunk(usersToInsert, 25);
  const accountBatches = chunk(accountsToInsert, 25);
  let processed = 0;

  for (let i = 0; i < userBatches.length; i++) {
    const uBatch = userBatches[i];
    const aBatch = accountBatches[i];
    await db.transaction(async (tx) => {
      await tx.insert(schema.user).values(uBatch).onConflictDoNothing();
      await tx.insert(schema.account).values(aBatch).onConflictDoNothing();
    });
    processed += uBatch.length;
    console.log(
      `  [Batch ${i + 1}/${userBatches.length}] Inserted batch of ${uBatch.length} users (${processed}/${RANDOM_USER_COUNT})`,
    );
  }
}

/**
 * Laravel-style seeder entry point
 * @see https://laravel.com/docs/seeding
 */
export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding users into Better Auth tables...\n');

  faker.seed(FAKER_SEED);

  await seedFixedUser(db);
  await seedRandomUsers(db);

  console.log(`\n  ✅ 1 demo user + ${RANDOM_USER_COUNT} random users`);
}

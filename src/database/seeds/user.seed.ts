import { faker } from '@faker-js/faker';
import { eq } from 'drizzle-orm';
import { chunk } from 'es-toolkit';
import { Role } from '@/common/constants/roles';
import { Hash } from '@/common/utils/hash.util';
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
 * MANAGER 20% / USER 80%
 */
const ROLE_POOL: Role[] = [...Array<Role>(4).fill(Role.MANAGER), ...Array<Role>(16).fill(Role.USER)];

/** 插入固定测试账号 */
async function seedFixedUser(db: DrizzleDB): Promise<void> {
  const passwordHash = await Hash.make(DEMO_USER.password);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, DEMO_USER.email),
  });

  if (!existing) {
    await db.insert(schema.users).values({
      name: DEMO_USER.name,
      email: DEMO_USER.email,
      passwordHash,
      role: DEMO_USER.role,
      emailVerifiedAt: new Date(),
    });
  }

  console.log(`  [1/${RANDOM_USER_COUNT + 1}] ${DEMO_USER.email} / ${DEMO_USER.password} (${DEMO_USER.role})`);
}

/** 使用 faker 批量生成随机用户（基于 es-toolkit chunk 分批落库） */
async function seedRandomUsers(db: DrizzleDB): Promise<void> {
  const passwordHash = await Hash.make(DEFAULT_PASSWORD);
  const usersToInsert: (typeof schema.users.$inferInsert)[] = [];

  for (let i = 0; i < RANDOM_USER_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const name = `${firstName} ${lastName}`;
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();
    const role = faker.helpers.arrayElement(ROLE_POOL);
    const avatarUrl = faker.image.avatarGitHub();

    // 70% 概率已验证邮箱
    const emailVerifiedAt = faker.number.int({ min: 1, max: 10 }) <= 7 ? new Date() : null;

    usersToInsert.push({
      name,
      email,
      passwordHash,
      role,
      emailVerifiedAt,
      avatarUrl,
    });
  }

  // 使用 es-toolkit chunk 将 100 条数据拆分为 4 个 batch 批量插入
  const batches = chunk(usersToInsert, 25);
  let processed = 0;

  for (const [idx, batch] of batches.entries()) {
    await db.insert(schema.users).values(batch).onConflictDoNothing();
    processed += batch.length;
    console.log(
      `  [Batch ${idx + 1}/${batches.length}] Inserted batch of ${batch.length} users (${processed}/${RANDOM_USER_COUNT})`,
    );
  }
}

/**
 * Laravel-style seeder entry point
 * @see https://laravel.com/docs/seeding
 */
export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding users...\n');

  faker.seed(FAKER_SEED);

  await seedFixedUser(db);
  await seedRandomUsers(db);

  console.log(`\n  ✅ 1 demo user + ${RANDOM_USER_COUNT} random users`);
}

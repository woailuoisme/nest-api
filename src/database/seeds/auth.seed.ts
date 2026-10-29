import { PasswordHasher } from '@nestjs/authentication';
import { seed } from 'drizzle-seed';
import { v7 as uuidv7 } from 'uuid';

import { Role } from '@/common/constants/roles';
import type { Database } from '@/database/drizzle/database';
import * as schema from '@/database/drizzle/schema';

export const description = 'Seed auth users via drizzle-seed — 3 fixed accounts + 100 random users';

const FIXED_ADMINS = [
  {
    name: 'Super Admin',
    email: 'admin@example.com',
    password: 'admin123456',
    role: Role.SUPER_ADMIN,
  },
  {
    name: 'Ops Manager',
    email: 'operator@example.com',
    password: 'operator123456',
    role: Role.OPERATOR,
  },
  {
    name: 'Demo User',
    email: 'user@nestforge.dev',
    password: 'password123',
    role: Role.USER,
  },
] as const;

export async function run(db: Database): Promise<void> {
  console.log('🌱 Seeding authentication users & accounts via drizzle-seed...\n');

  // 1. 按 FIXED_ADMINS 顺序预计算密码哈希
  const passwordHasher = new PasswordHasher();
  const passwordHashes = await Promise.all(FIXED_ADMINS.map((admin) => passwordHasher.hash(admin.password)));
  // 随机用户统一使用第三个账号的密码（password123）
  const defaultHash = passwordHashes[2];

  const authSchema = {
    user: schema.user,
    account: schema.account,
  };

  // 2. 注入 3 个确定性管理与测试账号：显式逐条写入。
  //    不能交给 drizzle-seed 的 valuesFromArray 分别生成 email / role / password ——
  //    各列独立取值，无法保证同一行的邮箱/角色/密码属于同一个账号，
  //    控制台打印的凭据于是会与库内实际组合不符（登录失败或拿到错误权限）。
  await db.transaction(async (tx) => {
    for (const [index, admin] of FIXED_ADMINS.entries()) {
      const userId = uuidv7();
      const now = new Date();

      await tx.insert(schema.user).values({
        id: userId,
        name: admin.name,
        email: admin.email,
        emailVerified: true,
        role: admin.role,
        createdAt: now,
        updatedAt: now,
      });

      // 凭据账号的 accountId 必须等于 userId（认证层以 userId + providerId 定位凭据账号）
      await tx.insert(schema.account).values({
        id: uuidv7(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: passwordHashes[index],
        createdAt: now,
        updatedAt: now,
      });

      console.log(`  [admin/demo] ${admin.email} / ${admin.password} (${admin.role})`);
    }
  });

  // 3. 批量生成 100 位随机用户
  const RANDOM_COUNT = 100;
  await seed(db, authSchema, { count: RANDOM_COUNT, seed: 42 }).refine((f) => ({
    user: {
      columns: {
        id: f.uuid(),
        name: f.fullName(),
        email: f.email(),
        role: f.valuesFromArray({
          values: [
            { weight: 0.1, values: [Role.OPERATOR] },
            { weight: 0.9, values: [Role.USER] },
          ],
        }),
        emailVerified: f.valuesFromArray({
          values: [
            { weight: 0.7, values: [true] },
            { weight: 0.3, values: [false] },
          ],
        }),
      },
      with: {
        account: 1,
      },
    },
    account: {
      columns: {
        id: f.uuid(),
        accountId: f.uuid(),
        providerId: f.default({ defaultValue: 'credential' }),
        password: f.default({ defaultValue: defaultHash }),
      },
    },
  }));

  console.log(`  [random] Generated ${RANDOM_COUNT} users (password: password123)`);
  console.log(`\n  ✅ 3 fixed accounts + ${RANDOM_COUNT} random users seeded successfully`);
}

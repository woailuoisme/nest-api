import { hashPassword } from 'better-auth/crypto';
import { seed } from 'drizzle-seed';

import { Role } from '@/common/constants/roles';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
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

export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding authentication users & accounts via drizzle-seed...\n');

  // 1. 预先计算标准密码哈希
  const [adminHash, operatorHash, defaultHash] = await Promise.all([
    hashPassword(FIXED_ADMINS[0].password),
    hashPassword(FIXED_ADMINS[1].password),
    hashPassword(FIXED_ADMINS[2].password),
  ]);

  const authSchema = {
    user: schema.user,
    account: schema.account,
  };

  // 2. 注入 3 个确定性管理与测试账号 (保证本地开发、E2E 测试与 k6 可直接登录)
  await seed(db, authSchema, { count: FIXED_ADMINS.length }).refine((f) => ({
    user: {
      columns: {
        id: f.uuid(),
        name: f.valuesFromArray({
          values: FIXED_ADMINS.map((a) => a.name),
        }),
        email: f.valuesFromArray({
          values: FIXED_ADMINS.map((a) => a.email),
          isUnique: true,
        }),
        role: f.valuesFromArray({
          values: FIXED_ADMINS.map((a) => a.role),
        }),
        emailVerified: f.default({ defaultValue: true }),
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
        password: f.valuesFromArray({
          values: [adminHash, operatorHash, defaultHash],
        }),
      },
    },
  }));

  for (const item of FIXED_ADMINS) {
    console.log(`  [admin/demo] ${item.email} / ${item.password} (${item.role})`);
  }

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

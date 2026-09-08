import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Role } from '@/common/constants/roles';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';

export const description = 'Seed admin users — 1 super admin + 1 operator';

const SEED_ADMINS = [
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
] as const;

export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding administrators into Better Auth user & account...\n');

  for (const item of SEED_ADMINS) {
    const existing = await db.query.user.findFirst({
      where: eq(schema.user.email, item.email),
    });

    if (!existing) {
      const userId = uuidv7();
      const passwordHash = await hashPassword(item.password);

      await db.transaction(async (tx) => {
        await tx.insert(schema.user).values({
          id: userId,
          name: item.name,
          email: item.email,
          emailVerified: true,
          role: item.role,
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

      console.log(`  [admin] ${item.email} / ${item.password} (${item.role})`);
    } else {
      console.log(`  [admin] ${item.email} (already exists)`);
    }
  }

  console.log('\n  ✅ Administrators seeded successfully');
}

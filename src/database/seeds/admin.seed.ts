import { eq } from 'drizzle-orm';
import { AdminRole, AdminStatus } from '@/common/constants/roles';
import { Hash } from '@/common/utils/hash.util';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';

export const description = 'Seed admin users — 1 super admin + 1 operator';

const SEED_ADMINS = [
  {
    name: 'Super Admin',
    email: 'admin@example.com',
    password: 'admin123456',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
  },
  {
    name: 'Ops Manager',
    email: 'operator@example.com',
    password: 'operator123456',
    role: AdminRole.OPERATOR,
    status: AdminStatus.ACTIVE,
  },
] as const;

export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding administrators...\n');

  for (const item of SEED_ADMINS) {
    const existing = await db.query.adminUsers.findFirst({
      where: eq(schema.adminUsers.email, item.email),
    });

    if (!existing) {
      const passwordHash = await Hash.make(item.password);
      await db.insert(schema.adminUsers).values({
        name: item.name,
        email: item.email,
        passwordHash,
        role: item.role,
        status: item.status,
      });
      console.log(`  [admin] ${item.email} / ${item.password} (${item.role})`);
    } else {
      console.log(`  [admin] ${item.email} (already exists)`);
    }
  }

  console.log('\n  ✅ Administrators seeded successfully');
}

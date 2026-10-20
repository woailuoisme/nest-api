import { seed } from 'drizzle-seed';

import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import * as schema from '@/database/drizzle/schema';

export const description = 'Seed notifications via drizzle-seed — polymorphic user message inbox';

const NOTIFICATION_TYPES = ['system.alert', 'user.welcome', 'security.login', 'billing.invoice', 'device.offline'];

export async function run(db: DrizzleDB): Promise<void> {
  console.log('🌱 Seeding notifications via drizzle-seed...\n');

  // 查询已初始化的用户以多态关联通知
  const users = await db.select({ id: schema.user.id }).from(schema.user).limit(50);
  if (users.length === 0) {
    console.log('  ⚠️ No users found in database, skipping notifications seed.');
    return;
  }

  const userIds = users.map((u) => u.id);
  const NOTIFICATIONS_COUNT = 50;

  await seed(db, { notifications: schema.notifications }, { count: NOTIFICATIONS_COUNT, seed: 42 }).refine((f) => ({
    notifications: {
      columns: {
        id: f.uuid(),
        type: f.valuesFromArray({ values: NOTIFICATION_TYPES }),
        notifiableType: f.default({ defaultValue: 'user' }),
        notifiableId: f.valuesFromArray({ values: userIds }),
        data: f.json(),
        readAt: f.weightedRandom([
          { weight: 0.5, value: f.timestamp() },
          { weight: 0.5, value: f.default({ defaultValue: null }) },
        ]),
      },
    },
  }));

  console.log(`  [notifications] Generated ${NOTIFICATIONS_COUNT} notifications across ${userIds.length} users`);
  console.log(`\n  ✅ Notifications seeded successfully`);
}

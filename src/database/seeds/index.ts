import 'dotenv/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { reset } from 'drizzle-seed';
import postgres from 'postgres';

import { DEFAULT_DB_URL } from '@/common/constants/app.constants';
import * as schema from '@/database/drizzle/schema';

import { description as authDesc, run as seedAuth } from './auth.seed';
import { description as notificationsDesc, run as seedNotifications } from './notifications.seed';

/**
 * Seeder 注册表 — 基于 drizzle-seed 的统一种子数据编排中心
 *
 * 每个 seeder 模块导出：
 * - `run(db)`        — 执行种子数据注入
 * - `description`    — 简短描述
 *
 * @example
 *   # 运行全部种子 (默认执行 reset + seed)
 *   just db-seed
 *   # 或 bun x tsx src/database/seeds/index.ts
 *
 *   # 只运行指定 seeder
 *   bun x tsx src/database/seeds/index.ts --only=auth
 *   bun x tsx src/database/seeds/index.ts --only=notifications
 *
 *   # 列出可用 seeder
 *   bun x tsx src/database/seeds/index.ts --help
 */

type SeederFn = (db: PostgresJsDatabase<typeof schema>) => Promise<void>;

const seeders: Record<string, { run: SeederFn; description: string }> = {
  auth: { run: seedAuth, description: authDesc },
  notifications: { run: seedNotifications, description: notificationsDesc },
};

function printAvailableSeeders(): void {
  console.log('\n📋 Available seeders (drizzle-seed):\n');
  for (const [name, { description }] of Object.entries(seeders)) {
    console.log(`  ${name.padEnd(16)} ${description}`);
  }
  console.log('\nUsage: bun x tsx src/database/seeds/index.ts [--only=auth,notifications] [--no-reset]');
}

function parseArgs(): { help: boolean; only: string[] | null; noReset: boolean } {
  const args = process.argv.slice(2);
  let help = false;
  let only: string[] | null = null;
  let noReset = false;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--no-reset') {
      noReset = true;
    } else if (arg.startsWith('--only=')) {
      only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim());
    }
  }

  return { help, only, noReset };
}

export async function seedDatabase(
  db: PostgresJsDatabase<typeof schema>,
  options?: { only?: string[] | null; noReset?: boolean; log?: (msg: string) => void },
): Promise<void> {
  const { only, noReset = false, log = console.log } = options ?? {};

  // 先校验未知名，避免静默跳过导致"看似成功实则未执行"
  const unknown = only?.filter((name) => !(name in seeders)) ?? [];
  if (unknown.length > 0) {
    throw new Error(`Unknown seeder(s): ${unknown.join(', ')}`);
  }

  // 依赖顺序：确保 auth 优先于 notifications 执行
  const executionOrder = ['auth', 'notifications'];
  const toRun = (only ?? executionOrder).filter((name) => name in seeders);

  // 1. 默认幂等清空对应表 (基于 drizzle-seed 原生 reset)
  if (!noReset) {
    log('🧹 Resetting database tables before seeding...');
    if (toRun.includes('auth') && toRun.includes('notifications')) {
      await reset(db, {
        user: schema.user,
        account: schema.account,
        session: schema.session,
        notifications: schema.notifications,
      });
    } else if (toRun.includes('auth')) {
      await reset(db, {
        user: schema.user,
        account: schema.account,
        session: schema.session,
      });
    } else if (toRun.includes('notifications')) {
      await reset(db, {
        notifications: schema.notifications,
      });
    }
    log('  ✅ Target tables truncated with CASCADE\n');
  }

  log(only ? `🌱 Running seeders: ${toRun.join(', ')}\n` : '🌱 Seeding database with drizzle-seed...\n');

  for (const name of toRun) {
    await seeders[name].run(db);
    log(''); // 空行分隔
  }

  log('✅ All seeds complete');
}

async function main(): Promise<void> {
  const { help, only, noReset } = parseArgs();

  if (help) {
    printAvailableSeeders();
    return;
  }

  const sql = postgres(process.env.DB_URL || DEFAULT_DB_URL, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(sql, { schema });

  try {
    await seedDatabase(db, { only, noReset });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.includes('seeds/index')) {
  main().catch((error: unknown) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  });
}

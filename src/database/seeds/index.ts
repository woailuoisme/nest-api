import 'dotenv/config';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/database/drizzle/schema';

import { description as adminDesc, run as seedAdmins } from './admin.seed';
import { run as seedUsers, description as userDesc } from './user.seed';

/**
 * Seeder 注册表 — Laravel DatabaseSeeder::call() 风格
 *
 * 每个 seeder 模块导出：
 * - `run(db)`        — 执行种子数据
 * - `description`    — 简短描述
 *
 * @example
 *   # 运行全部
 *   just db-seed
 *   # 或 bun x tsx src/database/seeds/index.ts
 *
 *   # 只运行指定 seeder
 *   bun x tsx src/database/seeds/index.ts --only=admin,user
 *
 *   # 列出可用 seeder
 *   bun x tsx src/database/seeds/index.ts --help
 */

type SeederFn = (db: PostgresJsDatabase<typeof schema>) => Promise<void>;

const seeders: Record<string, { run: SeederFn; description: string }> = {
  admin: { run: seedAdmins, description: adminDesc },
  user: { run: seedUsers, description: userDesc },
};

function printAvailableSeeders(): void {
  console.log('\n📋 Available seeders:\n');
  for (const [name, { description }] of Object.entries(seeders)) {
    console.log(`  ${name.padEnd(12)} ${description}`);
  }
  console.log('\nUsage: bun x tsx src/database/seeds/index.ts [--only=user]');
}

function parseArgs(): { help: boolean; only: string[] | null } {
  const args = process.argv.slice(2);
  let help = false;
  let only: string[] | null = null;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--only=')) {
      only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim());
    }
  }

  return { help, only };
}

export async function seedDatabase(
  db: PostgresJsDatabase<typeof schema>,
  options?: { only?: string[] | null; log?: (msg: string) => void },
): Promise<void> {
  const { only, log = console.log } = options ?? {};
  const toRun = only ? only.filter((name) => name in seeders) : Object.keys(seeders);

  if (only) {
    const invalid = only.filter((name) => !(name in seeders));
    if (invalid.length > 0) {
      throw new Error(`Unknown seeder(s): ${invalid.join(', ')}`);
    }
    log(`🌱 Running seeders: ${toRun.join(', ')}\n`);
  } else {
    log('🌱 Seeding database...\n');
  }

  for (const name of toRun) {
    await seeders[name].run(db);
    log(''); // 空行分隔
  }

  log('✅ All seeds complete');
}

async function main(): Promise<void> {
  const { help, only } = parseArgs();

  if (help) {
    printAvailableSeeders();
    return;
  }

  const sql = postgres(process.env.DB_URL ?? '', { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(sql, { schema });

  try {
    await seedDatabase(db, { only });
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

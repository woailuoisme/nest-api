import { createInterface } from 'node:readline';

import { Injectable, Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { seedDatabase } from '@/database/seeds';

interface DbSeedCommandOptions {
  yes?: boolean;
}

@Command({
  name: 'db:seed',
  description: 'Clear the database and run drizzle db seed',
})
@Injectable()
export class DbSeedCommand extends CommandRunner {
  private readonly logger = new Logger(DbSeedCommand.name);

  constructor(@InjectDb() private readonly db: DrizzleDB) {
    super();
  }

  async run(_passedParams: string[], options?: DbSeedCommandOptions): Promise<void> {
    if (!(options?.yes ?? false)) {
      const confirmed = await this.confirmClear();
      if (!confirmed) {
        this.logger.warn('Seed cancelled by user');
        return;
      }
    }

    this.logger.log('Clearing database tables...');
    await this.clearAllTables();

    this.logger.log('Running drizzle db seed...');
    await this.runSeedScript();

    this.logger.log('Database seeded successfully');
  }

  @Option({
    flags: '-y, --yes',
    description: 'Skip confirmation prompt',
  })
  parseYes(): boolean {
    return true;
  }

  /** 交互式确认清空数据库 */
  private confirmClear(): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\nWARNING: This will DELETE ALL DATA from the database!\nContinue? (y/N) ', (answer) => {
        rl.close();
        resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
      });
    });
  }

  /** 按外键依赖顺序清空所有用户表 */
  private async clearAllTables(): Promise<void> {
    await this.db.execute('SET session_replication_role = replica');

    try {
      const tables = await this.getUserTables();
      if (tables.length > 0) {
        await this.db.execute(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
        this.logger.log(`Truncated ${tables.length} table(s)`);
      }
    } finally {
      await this.db.execute('SET session_replication_role = origin');
    }
  }

  /** 获取 public schema 下所有用户表（排除 drizzle 迁移表） */
  private async getUserTables(): Promise<string[]> {
    const result = await this.db.execute<{ tablename: string }>(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('__drizzle_migrations', 'drizzle_migrations')",
    );
    return (Array.isArray(result) ? result : []).map((r) => r.tablename);
  }

  /** 执行 drizzle db seed 脚本 */
  private async runSeedScript(): Promise<void> {
    try {
      await seedDatabase(this.db, {
        log: (msg) => {
          if (msg.trim()) this.logger.log(msg);
        },
      });
    } catch (error) {
      this.logger.error('Seed execution failed', error);
      throw new Error('Seed script failed. The database has been cleared but not re-seeded.');
    }
  }
}

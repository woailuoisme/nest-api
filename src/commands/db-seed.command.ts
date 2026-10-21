import { createInterface } from 'node:readline';

import { Injectable, Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { seedDatabase } from '@/database/seeds';

import { applyMigrations, resolveMigrationsFolder } from './utils/migrations.util';

interface DbSeedCommandOptions {
  yes?: boolean;
  fresh?: boolean;
}

/**
 * Database seed command with two modes:
 *
 * 1. **Default (quasi-destructive)**: `TRUNCATE` all business table data (structure
 *    preserved) → seed;
 * 2. **`--fresh` (Laravel `migrate:fresh --seed` semantics)**: drop every table / view /
 *    enum in `public` plus the drizzle migration journal → re-run `drizzle/migrations` →
 *    seed.
 *
 * When neither `--fresh` nor `--yes` is passed, interactively asks whether to rebuild
 * the database; `--yes` means non-interactive (defaults to non-fresh).
 */
@Command({
  name: 'db:seed',
  description: 'Seed the database (add --fresh to drop all tables and re-run migrations first)',
})
@Injectable()
export class DbSeedCommand extends CommandRunner {
  private readonly logger = new Logger(DbSeedCommand.name);

  constructor(@InjectDb() private readonly db: DrizzleDB) {
    super();
  }

  async run(_passedParams: string[], options?: DbSeedCommandOptions): Promise<void> {
    const assumeYes = options?.yes ?? false;

    // 1. Resolve mode: explicit --fresh wins; otherwise ask in interactive mode
    let fresh = options?.fresh ?? false;
    let confirmed = false;

    if (!options?.fresh && !assumeYes) {
      fresh = await this.askFreshMode();
      // Choosing the rebuild itself is an explicit confirmation, no need to ask again
      confirmed = fresh;
    }

    // 2. Destructive confirmation (--yes skips)
    if (!assumeYes && !confirmed) {
      const ok = fresh ? await this.confirmFresh() : await this.confirmTruncate();
      if (!ok) {
        this.logger.warn('Seed cancelled by user');
        return;
      }
    }

    if (fresh) {
      this.logger.log('Dropping all tables, views and enum types...');
      await this.dropAllStructure();
      this.logger.log('Re-running drizzle migrations...');
      await this.runMigrations();
    } else {
      this.logger.log('Truncating all table data (structure preserved)...');
      await this.clearAllTables();
    }

    this.logger.log('Running drizzle db seed...');
    await this.runSeedScript();

    this.logger.log(fresh ? 'Database rebuilt and seeded successfully' : 'Database data reset and seeded successfully');
  }

  @Option({
    flags: '-f, --fresh',
    description: 'Drop all tables and re-run migrations before seeding',
  })
  parseFresh(): boolean {
    return true;
  }

  @Option({
    flags: '-y, --yes',
    description: 'Skip confirmation prompts (implies non-fresh unless --fresh is set)',
  })
  parseYes(): boolean {
    return true;
  }

  /** Ask whether to rebuild the database (answering N only clears data) */
  private askFreshMode(): Promise<boolean> {
    return this.ask(
      '\nRebuild the database?\n  Y: drop every table structure -> re-run migrations -> seed (structure AND data are lost)\n  N: truncate all table data -> seed (structure preserved)\nRebuild database? (y/N) ',
    );
  }

  /** Interactive confirmation: full rebuild (structure and data are lost) */
  private confirmFresh(): Promise<boolean> {
    return this.ask(
      '\nWARNING: this will DROP all table structures and re-run migrations. Data is unrecoverable. Continue? (y/N) ',
    );
  }

  /** Interactive confirmation: data-only truncate */
  private confirmTruncate(): Promise<boolean> {
    return this.ask('\nWARNING: this will truncate all table data (structure preserved). Continue? (y/N) ');
  }

  private ask(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
      });
    });
  }

  /** Truncate all business table data (keeps the drizzle journal and extension tables) */
  private async clearAllTables(): Promise<void> {
    await this.withTriggersDisabled(async () => {
      const tables = await this.listRelations('r');
      const userTables = tables.filter((name) => !name.startsWith('__drizzle_'));
      if (userTables.length === 0) return;

      await this.db.execute(`TRUNCATE TABLE ${this.quoteList(userTables)} RESTART IDENTITY CASCADE`);
      this.logger.log(`Truncated ${userTables.length} table(s)`);
    });
  }

  /**
   * Drop every table / view / enum in `public` and clear the drizzle migration journal.
   *
   * Only the `public` and `drizzle` schemas are touched — never `DROP SCHEMA public
   * CASCADE`, which would also destroy schema-level grants and extension objects,
   * exceeding the scope of "rebuild business tables".
   */
  private async dropAllStructure(): Promise<void> {
    await this.withTriggersDisabled(async () => {
      const tables = await this.listRelations('r');
      const views = await this.listRelations('v');
      const enums = await this.listEnums();

      if (views.length > 0) {
        await this.db.execute(`DROP VIEW IF EXISTS ${this.quoteList(views)} CASCADE`);
      }
      if (tables.length > 0) {
        await this.db.execute(`DROP TABLE IF EXISTS ${this.quoteList(tables)} CASCADE`);
      }
      if (enums.length > 0) {
        await this.db.execute(`DROP TYPE IF EXISTS ${this.quoteList(enums)} CASCADE`);
      }

      // The journal must be cleared too, otherwise migrate() considers all history
      // migrations applied and skips everything
      await this.db.execute('DROP SCHEMA IF EXISTS drizzle CASCADE');

      this.logger.log(`Dropped ${tables.length} table(s), ${views.length} view(s), ${enums.length} enum type(s)`);
    });
  }

  /**
   * Run DDL / TRUNCATE in a session with foreign keys and triggers disabled.
   *
   * `session_replication_role` is a session-level setting and must be restored in
   * `finally`; otherwise reused connections would let later business writes bypass
   * foreign keys and triggers.
   */
  private async withTriggersDisabled(run: () => Promise<void>): Promise<void> {
    await this.db.execute('SET session_replication_role = replica');
    try {
      await run();
    } finally {
      await this.db.execute('SET session_replication_role = origin');
    }
  }

  /**
   * List plain tables (`r`) or views (`v`) in `public`, **excluding extension-owned
   * objects**.
   *
   * Extensions such as PostGIS place `geography_columns` / `spatial_ref_sys` in
   * `public`; they are managed by the extension and DROP fails on them (both
   * permission and dependency constraints).
   */
  private async listRelations(kind: 'r' | 'v'): Promise<string[]> {
    const result = await this.db.execute<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = '${kind}'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_depend d
             WHERE d.objid = c.oid
               AND d.classid = 'pg_catalog.pg_class'::regclass
               AND d.deptype = 'e'
          )`,
    );
    return (Array.isArray(result) ? result : []).map((row) => row.name);
  }

  /** List enum type names in `public` (extension-owned excluded as well) */
  private async listEnums(): Promise<string[]> {
    const result = await this.db.execute<{ typname: string }>(
      `SELECT t.typname FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_depend d
             WHERE d.objid = t.oid
               AND d.classid = 'pg_catalog.pg_type'::regclass
               AND d.deptype = 'e'
          )`,
    );
    return (Array.isArray(result) ? result : []).map((row) => row.typname);
  }

  private quoteList(names: string[]): string {
    return names.map((name) => `"${name.replace(/"/g, '""')}"`).join(', ');
  }

  /** Re-run all migrations (fails loudly when the migrations folder is missing) */
  private async runMigrations(): Promise<void> {
    await applyMigrations(this.db, resolveMigrationsFolder(), 'structure was cleared but migrations failed');
  }

  /** Run the drizzle db seed script */
  private async runSeedScript(): Promise<void> {
    try {
      await seedDatabase(this.db, {
        log: (msg) => {
          if (msg.trim()) this.logger.log(msg);
        },
      });
    } catch (error) {
      this.logger.error('Seed execution failed', error);
      throw new Error('Seed script failed. Migrations succeeded but seeding failed.');
    }
  }
}

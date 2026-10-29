import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Database } from '@/database/drizzle/database';

const migrationsLogger = new Logger('Migrations');

/** Migrations folder (rooted at cwd: repo root locally, /app in containers) */
export function resolveMigrationsFolder(cwd = process.cwd()): string {
  return resolve(cwd, 'drizzle/migrations');
}

/** Fail with an actionable hint when the migrations folder is missing (not generated locally / not COPY-ed into the image) */
export function assertMigrationsFolder(folder: string): void {
  if (existsSync(folder)) return;
  throw new Error(
    `Migrations folder not found: ${folder} (run "just db-gen" locally; make sure the image COPYs drizzle/migrations)`,
  );
}

export interface LegacyJournalRow {
  id: number;
  created_at: string | number;
}

/**
 * Pair pre-v1 journal rows (`name IS NULL`) with local migration folders.
 *
 * Drizzle v1 identifies applied migrations by folder name; databases migrated with
 * drizzle-kit v0 only carry `created_at`. The v0 journal stored the generation
 * timestamp with millisecond precision while v1 folder names only keep seconds, so
 * match at second precision. Rows without a confident match are left untouched so
 * the caller can fail closed instead of guessing.
 */
export function matchLegacyJournalNames(
  rows: readonly LegacyJournalRow[],
  migrations: readonly Pick<MigrationMeta, 'folderMillis' | 'name'>[],
): { id: number; name: string }[] {
  const bySecond = new Map(migrations.map((migration) => [Math.floor(migration.folderMillis / 1000), migration.name]));
  return rows.flatMap((row) => {
    const name = bySecond.get(Math.floor(Number(row.created_at) / 1000));
    return name ? [{ id: row.id, name }] : [];
  });
}

/**
 * Backfill `drizzle.__drizzle_migrations.name` for rows written before Drizzle v1.
 *
 * Without names, v1 treats every local migration as unapplied and re-runs the first
 * one inside a transaction, which fails with "relation already exists" and blocks the
 * upgrade. Fail closed when a row cannot be matched by timestamp.
 */
export async function repairLegacyJournalNames(db: Database, folder: string): Promise<void> {
  const journal = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!journal.rows[0]?.exists) return;

  // v0 journals lack the `name` column entirely; add it before backfilling.
  await db.execute(sql`alter table drizzle.__drizzle_migrations add column if not exists name text`);

  const result = await db.execute<LegacyJournalRow>(
    sql`select id, created_at from drizzle.__drizzle_migrations where name is null order by id`,
  );
  const rows = result.rows;
  if (rows.length === 0) return;

  const matches = matchLegacyJournalNames(rows, readMigrationFiles({ migrationsFolder: folder }));
  for (const { id, name } of matches) {
    await db.execute(sql`update drizzle.__drizzle_migrations set name = ${name} where id = ${id} and name is null`);
  }

  if (matches.length !== rows.length) {
    throw new Error(
      `Migration journal has ${rows.length - matches.length} legacy row(s) that do not match any local migration timestamp. ` +
        'Rebuild the database ("just db-fresh") or backfill drizzle.__drizzle_migrations.name manually before migrating.',
    );
  }

  migrationsLogger.warn(
    `Backfilled ${matches.length} pre-v1 migration journal name(s); Drizzle v1 identifies migrations by folder name.`,
  );
}

/**
 * Apply `drizzle/migrations` (already-applied migrations are skipped by the journal).
 *
 * Drizzle's top-level message is the whole SQL statement; the real pg reason lives on
 * `cause` — extract it into a readable summary here, with a caller-provided label for
 * context (e.g. "structure was cleared but migrations failed").
 */
export async function applyMigrations(db: Database, folder: string, failureLabel = 'Migrations failed'): Promise<void> {
  assertMigrationsFolder(folder);

  try {
    await repairLegacyJournalNames(db, folder);
    await migrate(db, { migrationsFolder: folder });
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    throw new Error(`${failureLabel}${cause ? `: ${cause}` : ''}`, { cause });
  }
}

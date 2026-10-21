import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

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

/**
 * Apply `drizzle/migrations` (already-applied migrations are skipped by the journal).
 *
 * Drizzle's top-level message is the whole SQL statement; the real pg reason lives on
 * `cause` — extract it into a readable summary here, with a caller-provided label for
 * context (e.g. "structure was cleared but migrations failed").
 */
export async function applyMigrations(
  db: DrizzleDB,
  folder: string,
  failureLabel = 'Migrations failed',
): Promise<void> {
  assertMigrationsFolder(folder);

  try {
    await migrate(db, { migrationsFolder: folder });
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    throw new Error(`${failureLabel}${cause ? `: ${cause}` : ''}`, { cause });
  }
}

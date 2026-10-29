import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Command, CommandRunner, Option } from 'nest-commander';

import { StorageService } from '@/common/storage/storage.service';
import type { Database } from '@/database/drizzle/database';

import { readEnvValue, upsertEnvValue } from './utils/env-file.util';
import { applyMigrations, resolveMigrationsFolder } from './utils/migrations.util';

interface AppInitOptions {
  force?: boolean;
  env?: string;
}

type StepStatus = 'done' | 'skipped' | 'failed';

interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

/** Auth secrets that must exist, with their random byte sizes */
const SECRET_KEYS = [
  { key: 'JWT_SECRET', bytes: 32 },
  { key: 'MFA_ENCRYPTION_KEYS', bytes: 32 },
] as const;

const STATUS_LABEL: Record<StepStatus, string> = {
  done: '\x1b[32m[OK]\x1b[0m',
  skipped: '\x1b[33m[SKIPPED]\x1b[0m',
  failed: '\x1b[31m[FAILED]\x1b[0m',
};

/**
 * One-shot initializer — auth secrets / database migrations / S3 bucket.
 *
 * Every step is idempotent: secrets are generated only when missing, migrations are
 * skipped per `__drizzle_migrations`, and the bucket is skipped when it already
 * exists, so re-running has no side effects. `--force` only forces secret
 * regeneration.
 */
@Command({
  name: 'app:init',
  description: 'Idempotently initialize auth secrets, database schema and S3 bucket',
})
@Injectable()
export class AppInitCommand extends CommandRunner {
  private readonly logger = new Logger(AppInitCommand.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async run(_passedParams: string[], options?: AppInitOptions): Promise<void> {
    const envFile = options?.env ?? '.env';
    const force = options?.force ?? false;

    const steps: { step: string; run: () => Promise<StepResult> | StepResult }[] = [
      { step: 'Auth secrets', run: () => this.initSecrets(envFile, force) },
      { step: 'Database migrations', run: () => this.initDatabase() },
      { step: 'S3 bucket', run: () => this.initStorage() },
    ];

    const results: StepResult[] = [];
    for (const { step, run } of steps) {
      try {
        results.push(await run());
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(`${step} initialization failed: ${detail}`);
        results.push({ step, status: 'failed', detail });
        process.exitCode = 1;
        break;
      }
    }

    console.log('\nInitialization summary:');
    for (const r of results) {
      console.log(`  ${STATUS_LABEL[r.status]} ${r.step} — ${r.detail}`);
    }
  }

  @Option({
    flags: '-f, --force',
    description: 'Regenerate auth secrets even if they already exist',
  })
  parseForce(): boolean {
    return true;
  }

  @Option({
    flags: '-e, --env <path>',
    description: 'Path to target .env file',
    defaultValue: '.env',
  })
  parseEnv(val: string): string {
    return val;
  }

  // ── Steps ──────────────────────────────────────────────

  /** Ensure the three secrets exist; keep existing non-empty values (no rotation, avoids invalidating live tokens) */
  private initSecrets(envFile: string, force: boolean): StepResult {
    const targetPath = resolve(envFile);
    // Never create the env file: in containers it is injected via env_file, and writing
    // to disk at runtime affects neither the current process nor the next start
    if (!existsSync(targetPath)) {
      return {
        step: 'Auth secrets',
        status: 'skipped',
        detail: `${targetPath} not found; secrets must be injected by the deployment environment (env_file in container stacks). --force only applies to an existing env file`,
      };
    }

    let content = readFileSync(targetPath, 'utf8');
    const written: string[] = [];

    for (const { key, bytes } of SECRET_KEYS) {
      if (!force && readEnvValue(content, key)) continue;
      content = upsertEnvValue(content, key, randomBytes(bytes).toString('base64url'));
      written.push(key);
    }

    if (written.length === 0) {
      return {
        step: 'Auth secrets',
        status: 'skipped',
        detail: `all ${SECRET_KEYS.length} keys already exist, keeping current values`,
      };
    }

    writeFileSync(targetPath, content, 'utf8');
    return { step: 'Auth secrets', status: 'done', detail: `${targetPath}: wrote ${written.join(', ')}` };
  }

  /** Migrations folder (overridable for tests; shared with db:seed) */
  protected migrationsFolder(): string {
    return resolveMigrationsFolder();
  }

  /** Apply drizzle/migrations; already-applied migrations are skipped by the journal table */
  private async initDatabase(): Promise<StepResult> {
    await applyMigrations(this.db, this.migrationsFolder());
    return { step: 'Database migrations', status: 'done', detail: 'schema is up to date' };
  }

  /** Ensure the S3 bucket exists; skipped when STORAGE_S3_URL is unset (local driver) */
  private async initStorage(): Promise<StepResult> {
    if (!this.storage.isS3Configured?.()) {
      return { step: 'S3 bucket', status: 'skipped', detail: 'STORAGE_S3_URL not configured, using the local driver' };
    }

    const s3Config = this.storage.getS3Config?.();
    const bucket = s3Config?.bucket ?? 'default';

    if (await this.storage.checkS3BucketExists()) {
      return { step: 'S3 bucket', status: 'skipped', detail: `bucket ${bucket} already exists` };
    }

    const { created } = await this.storage.ensureS3Bucket();
    if (created) {
      return { step: 'S3 bucket', status: 'done', detail: `bucket ${bucket} created` };
    }

    // `created: false` 同时覆盖「PUT 失败」与「桶已被并发创建/HEAD 曾被拒」两种情形，
    // 故回查一次再判定：仍不存在即真实失败，必须抛错让命令以非零码退出（否则运维会
    // 看到绿色的 "bucket created"，故障被推迟到首次上传才以 5xx 暴露）。
    if (await this.storage.checkS3BucketExists()) {
      return { step: 'S3 bucket', status: 'skipped', detail: `bucket ${bucket} already exists` };
    }

    throw new Error(`创建 S3 bucket 失败：${bucket}（检查凭证、建桶权限与 endpoint 连通性）`);
  }
}

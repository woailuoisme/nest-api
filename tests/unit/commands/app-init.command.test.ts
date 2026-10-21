import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppInitCommand } from '@/commands/app-init.command';
import type { StorageService } from '@/common/storage/storage.service';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';

vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: vi.fn() }));

/** 未配置 S3 的存储门面桩：disk('s3') 返回非 S3 驱动实例 */
const noS3Storage = { disk: () => ({}) } as unknown as StorageService;

const makeCommand = (storage: StorageService = noS3Storage): AppInitCommand =>
  new AppInitCommand({} as unknown as DrizzleDB, storage);

const readEnv = (path: string): string => readFileSync(path, 'utf8');

const envValue = (content: string, key: string): string | undefined =>
  content.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];

describe('AppInitCommand', () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-init-'));
    envPath = join(dir, '.env');
    vi.mocked(migrate).mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('密钥缺失时生成三项并写入 env 文件', async () => {
    writeFileSync(envPath, '', 'utf8');
    await makeCommand().run([], { env: envPath });

    const content = readEnv(envPath);
    expect(envValue(content, 'BETTER_AUTH_SECRET')).toBeTruthy();
    expect(envValue(content, 'JWT_ACCESS_SECRET')).toBeTruthy();
    expect(envValue(content, 'JWT_REFRESH_SECRET')).toBeTruthy();
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it('重复执行不覆盖已有密钥（幂等）', async () => {
    writeFileSync(envPath, '', 'utf8');
    await makeCommand().run([], { env: envPath });
    const first = readEnv(envPath);

    await makeCommand().run([], { env: envPath });

    expect(readEnv(envPath)).toBe(first);
  });

  it('env 文件不存在时跳过密钥生成，且不创建文件（容器场景由 env_file 注入）', async () => {
    const absent = join(dir, 'absent.env');

    await makeCommand().run([], { env: absent });

    const summary = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .join('\n');
    expect(summary).toContain('Auth secrets');
    expect(summary).toContain('injected by the deployment environment');
    expect(existsSync(absent)).toBe(false);
  });

  it('--force 时重新生成密钥', async () => {
    const original = [
      'BETTER_AUTH_SECRET=old-value',
      'JWT_ACCESS_SECRET=old-access',
      'JWT_REFRESH_SECRET=old-refresh',
    ].join('\n');
    writeFileSync(envPath, `${original}\n`, 'utf8');

    await makeCommand().run([], { env: envPath, force: true });

    const content = readEnv(envPath);
    expect(envValue(content, 'BETTER_AUTH_SECRET')).not.toBe('old-value');
    expect(envValue(content, 'JWT_ACCESS_SECRET')).not.toBe('old-access');
    expect(envValue(content, 'JWT_REFRESH_SECRET')).not.toBe('old-refresh');
  });

  it('未配置 S3 时跳过且不触达 SDK', async () => {
    await makeCommand().run([], { env: envPath });

    const summary = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .join('\n');
    expect(summary).toContain('S3 bucket');
    expect(summary).toContain('[SKIPPED]');
  });

  it('迁移目录缺失时中止并置非零退出码', async () => {
    // 覆写迁移目录指向不存在的路径（worker 内不可 chdir）
    class MissingMigrationsCommand extends AppInitCommand {
      protected migrationsFolder(): string {
        return join(dir, 'no-such-migrations');
      }
    }

    await new MissingMigrationsCommand({} as unknown as DrizzleDB, noS3Storage).run([], { env: envPath });

    expect(migrate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

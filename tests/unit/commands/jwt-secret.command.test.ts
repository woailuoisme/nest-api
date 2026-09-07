import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtSecretCommand } from '@/commands/jwt-secret.command';
import { PATHS } from '@/common/constants/app.constants';

describe('JwtSecretCommand', () => {
  let command: JwtSecretCommand;
  const testEnvPath = resolve(process.cwd(), PATHS.STORAGE_TMP, '.env.spec.tmp');

  beforeEach(() => {
    command = new JwtSecretCommand();
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
  });

  afterEach(() => {
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
    vi.restoreAllMocks();
  });

  it('应成功在现有 .env 文件中注入生成的 base64url 密钥', async () => {
    writeFileSync(testEnvPath, 'APP_ENV=local\n# other config\n', 'utf8');

    await command.run([], { env: testEnvPath });

    const updatedContent = readFileSync(testEnvPath, 'utf8');
    expect(updatedContent).toContain('JWT_ACCESS_SECRET=');
    expect(updatedContent).toContain('JWT_REFRESH_SECRET=');

    const accessMatch = updatedContent.match(/JWT_ACCESS_SECRET=([A-Za-z0-9_-]+)/);
    const refreshMatch = updatedContent.match(/JWT_REFRESH_SECRET=([A-Za-z0-9_-]+)/);
    expect(accessMatch).not.toBeNull();
    expect(refreshMatch).not.toBeNull();
    expect(accessMatch?.[1]).not.toBe(refreshMatch?.[1]);
  });

  it('当目标 .env 不存在时应自动创建并写入两个 JWT 密钥', async () => {
    await command.run([], { env: testEnvPath });

    expect(existsSync(testEnvPath)).toBe(true);
    const createdContent = readFileSync(testEnvPath, 'utf8');
    expect(createdContent).toMatch(/JWT_ACCESS_SECRET=.+/);
    expect(createdContent).toMatch(/JWT_REFRESH_SECRET=.+/);
  });

  it('should display secrets in console if show option is true', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], { env: testEnvPath, show: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[jwt:secret]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_ACCESS_SECRET:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_REFRESH_SECRET:'));
  });

  it('should correctly parse options methods', () => {
    expect(command.parseShow()).toBe(true);
    expect(command.parseEnv('.env.custom')).toBe('.env.custom');
  });
});

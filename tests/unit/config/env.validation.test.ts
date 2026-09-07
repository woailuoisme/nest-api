import { describe, expect, it } from 'vitest';
import { validateEnv } from '@/config/env.validation';

/** 构造通过校验所需的最小配置，overrides 覆盖待测字段 */
function envOf(overrides: Record<string, unknown>) {
  return validateEnv({
    APP_ENV: 'local',
    DB_URL: 'postgres://localhost:5432/nestforge',
    JWT_ACCESS_SECRET: 'access-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'refresh-secret-at-least-16-chars',
    ...overrides,
  });
}

describe('envBoolean (APP_DEBUG / WORKER_EMBEDDED)', () => {
  it('字符串 "false" 解析为 false（Laravel FILTER_VALIDATE_BOOLEAN 语义）', () => {
    const config = envOf({ APP_DEBUG: 'false', WORKER_EMBEDDED: 'false' });
    expect(config.APP_DEBUG).toBe(false);
    expect(config.WORKER_EMBEDDED).toBe(false);
  });

  it('字符串 "true" 解析为 true', () => {
    const config = envOf({ APP_DEBUG: 'true', WORKER_EMBEDDED: 'true' });
    expect(config.APP_DEBUG).toBe(true);
    expect(config.WORKER_EMBEDDED).toBe(true);
  });

  it('大小写不敏感（"TRUE"/"False"）', () => {
    const config = envOf({ APP_DEBUG: 'TRUE', WORKER_EMBEDDED: '1' });
    expect(config.APP_DEBUG).toBe(true);
    expect(config.WORKER_EMBEDDED).toBe(true);
  });

  it('"0"/"off"/空串均解析为 false', () => {
    const config = envOf({ APP_DEBUG: '0', WORKER_EMBEDDED: '0' });
    expect(config.APP_DEBUG).toBe(false);
    expect(config.WORKER_EMBEDDED).toBe(false);
    const empty = envOf({ APP_DEBUG: '', WORKER_EMBEDDED: '' });
    expect(empty.APP_DEBUG).toBe(false);
    expect(empty.WORKER_EMBEDDED).toBe(false);
  });

  it('未配置时回退默认 false', () => {
    const config = envOf({});
    expect(config.APP_DEBUG).toBe(false);
    expect(config.WORKER_EMBEDDED).toBe(false);
  });
});

describe('URL Configurations (REDIS_URL / MAIL_URL / STORAGE_S3_URL)', () => {
  it('未配置时回退默认 URL', () => {
    const config = envOf({});
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.MAIL_URL).toBe('smtp://localhost:1025');
    expect(config.STORAGE_S3_URL).toBeUndefined();
  });

  it('显式提供时正确载入', () => {
    const config = envOf({
      REDIS_URL: 'redis://:auth@valkey:6380/1',
      MAIL_URL: 'smtp://user:pass@smtp.mailgun.org:587',
      STORAGE_S3_URL: 's3://key:sec@garage:3900/bucket?region=garage',
    });
    expect(config.REDIS_URL).toBe('redis://:auth@valkey:6380/1');
    expect(config.MAIL_URL).toBe('smtp://user:pass@smtp.mailgun.org:587');
    expect(config.STORAGE_S3_URL).toBe('s3://key:sec@garage:3900/bucket?region=garage');
  });
});

describe('MAIL_FROM_ADDRESS', () => {
  it('未配置时回退默认地址', () => {
    const config = envOf({});
    expect(config.MAIL_FROM_ADDRESS).toBe('no-reply@nestforge.dev');
  });

  it('显式空串启动即失败（拒绝运行时 from: ""）', () => {
    expect(() => envOf({ MAIL_FROM_ADDRESS: '' })).toThrow(/MAIL_FROM_ADDRESS/);
  });
});

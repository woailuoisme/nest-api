import { describe, expect, it } from 'vitest';

import { envSchema } from '@/config/env.validation';

/** 构造通过校验所需的最小配置，overrides 覆盖待测字段 */
function envOf(overrides: Record<string, unknown>) {
  return envSchema.parse({
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

describe('Smart Defaults & Derivations', () => {
  it('STORAGE_DRIVER: 未配置且无 S3 URL 时推导为 local', () => {
    const config = envOf({});
    expect(config.STORAGE_DRIVER).toBe('local');
  });

  it('STORAGE_DRIVER: 未配置但有 S3 URL 时自动推导为 s3', () => {
    const config = envOf({
      STORAGE_S3_URL: 's3://key:sec@garage:3900/bucket?region=garage',
    });
    expect(config.STORAGE_DRIVER).toBe('s3');
  });

  it('STORAGE_DRIVER: 显式指定时尊重显式配置', () => {
    const config = envOf({
      STORAGE_DRIVER: 'local',
      STORAGE_S3_URL: 's3://key:sec@garage:3900/bucket?region=garage',
    });
    expect(config.STORAGE_DRIVER).toBe('local');
  });

  it('BETTER_AUTH_URL: 未配置时自动级联 APP_URL', () => {
    const config = envOf({ APP_URL: 'http://my-domain.dev:4300' });
    expect(config.BETTER_AUTH_URL).toBe('http://my-domain.dev:4300');
  });

  it('BETTER_AUTH_URL: 显式配置时使用显式值', () => {
    const config = envOf({
      APP_URL: 'http://my-domain.dev:4300',
      BETTER_AUTH_URL: 'http://auth.my-domain.dev',
    });
    expect(config.BETTER_AUTH_URL).toBe('http://auth.my-domain.dev');
  });

  it('BROADCAST_DRIVER: 默认使用 centrifugo 驱动', () => {
    const config = envOf({});
    expect(config.BROADCAST_DRIVER).toBe('centrifugo');
  });

  it('BROADCAST_DRIVER: 显式指定 local 时尊重显式配置', () => {
    const config = envOf({ BROADCAST_DRIVER: 'local' });
    expect(config.BROADCAST_DRIVER).toBe('local');
  });

  it('极简配置: 仅提供 DB_URL 时自动产出完整的工业级默认配置', () => {
    const config = envSchema.parse({
      DB_URL: 'postgresql://postgres:pass@localhost:5432/db',
    });
    expect(config.APP_ENV).toBe('local');
    expect(config.APP_DEBUG).toBe(false);
    expect(config.PORT).toBe(4300);
    expect(config.APP_URL).toBe('http://localhost:4300');
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.BETTER_AUTH_URL).toBe('http://localhost:4300');
    expect(config.BROADCAST_DRIVER).toBe('centrifugo');
    expect(config.HTTP_TIMEOUT_MS).toBe(15_000);
    expect(config.WORKER_EMBEDDED).toBe(false);
    expect(config.MEDIA_QUEUE_ENABLED).toBe(true);
    expect(config.SWAGGER_ENABLED).toBe(true);
  });
});

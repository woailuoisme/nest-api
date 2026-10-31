import { describe, expect, it } from 'vitest';

import { envSchema } from '@/config/env.validation';

/** 构造通过校验所需的最小配置，overrides 覆盖待测字段 */
function envOf(overrides: Record<string, unknown>) {
  return envSchema.parse({
    APP_ENV: 'local',
    DB_URL: 'postgres://localhost:5432/nestforge',
    ...overrides,
  });
}

describe('envBoolean (APP_DEBUG)', () => {
  it('字符串 "false" 解析为 false（Laravel FILTER_VALIDATE_BOOLEAN 语义）', () => {
    const config = envOf({ APP_DEBUG: 'false' });
    expect(config.APP_DEBUG).toBe(false);
  });

  it('字符串 "true" 解析为 true', () => {
    const config = envOf({ APP_DEBUG: 'true' });
    expect(config.APP_DEBUG).toBe(true);
  });

  it('大小写不敏感（"TRUE"/"False"）', () => {
    const config = envOf({ APP_DEBUG: 'TRUE' });
    expect(config.APP_DEBUG).toBe(true);
  });

  it('"0"/"off"/空串均解析为 false', () => {
    const config = envOf({ APP_DEBUG: '0' });
    expect(config.APP_DEBUG).toBe(false);
    const empty = envOf({ APP_DEBUG: '' });
    expect(empty.APP_DEBUG).toBe(false);
  });

  it('未配置时回退默认 false', () => {
    const config = envOf({});
    expect(config.APP_DEBUG).toBe(false);
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
    expect(config.MAIL_FROM_ADDRESS).toBe('no-reply@example.com');
  });

  it('显式空串启动即失败（拒绝运行时 from: ""）', () => {
    expect(() => envOf({ MAIL_FROM_ADDRESS: '' })).toThrow(/MAIL_FROM_ADDRESS/);
  });
});

describe('MAIL_TRANSPORT', () => {
  it('非测试环境默认 smtp，测试环境默认 file（不真正投递）', () => {
    expect(envOf({}).MAIL_TRANSPORT).toBe('smtp');
    expect(envOf({ APP_ENV: 'testing' }).MAIL_TRANSPORT).toBe('file');
  });

  it('显式 resend 驱动被接受（启动期由传输工厂校验 Key）', () => {
    expect(envOf({ MAIL_TRANSPORT: 'resend' }).MAIL_TRANSPORT).toBe('resend');
  });

  const PROD_MAIL_BASE = {
    APP_ENV: 'production',
    MAIL_URL: 'smtp://mail.example.org:587',
    MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
    DB_URL: 'postgresql://app:secret@db:5432/nest_api',
    JWT_SECRET: 'j'.repeat(32),
    MFA_ENCRYPTION_KEYS: 'm'.repeat(32),
    OTP_HMAC_KEY: 'o'.repeat(32),
    WEPAY_ALLOW_MOCK: 'true',
  };

  it('生产环境禁止 localhost SMTP 与 example.com 发件人', () => {
    expect(() => envSchema.parse({ ...PROD_MAIL_BASE, MAIL_URL: 'smtp://localhost:1025' })).toThrow(/MAIL_URL/);
    expect(() => envSchema.parse({ ...PROD_MAIL_BASE, MAIL_FROM_ADDRESS: 'no-reply@example.com' })).toThrow(
      /MAIL_FROM_ADDRESS/,
    );
  });

  it('生产环境禁止 file 驱动', () => {
    expect(() => envSchema.parse({ ...PROD_MAIL_BASE, MAIL_TRANSPORT: 'file' })).toThrow(/MAIL_TRANSPORT/);
  });

  it('生产环境 resend 缺 API Key 时拒绝启动', () => {
    expect(() => envSchema.parse({ ...PROD_MAIL_BASE, MAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() =>
      envSchema.parse({ ...PROD_MAIL_BASE, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }),
    ).not.toThrow();
  });
});

describe('Smart Defaults & Derivations', () => {
  it('FILESYSTEM_DISK: 未配置且无 S3 URL 时推导为 local', () => {
    const config = envOf({});
    expect(config.FILESYSTEM_DISK).toBe('local');
  });

  it('FILESYSTEM_DISK: 未配置但有 S3 URL 时自动推导为 s3', () => {
    const config = envOf({
      STORAGE_S3_URL: 's3://key:sec@garage:3900/bucket?region=garage',
    });
    expect(config.FILESYSTEM_DISK).toBe('s3');
  });

  it('FILESYSTEM_DISK: 显式指定时尊重显式配置', () => {
    const config = envOf({
      FILESYSTEM_DISK: 'local',
      STORAGE_S3_URL: 's3://key:sec@garage:3900/bucket?region=garage',
    });
    expect(config.FILESYSTEM_DISK).toBe('local');
  });

  it('SCOUT_DRIVER: 未配置且无 SEARCH_URL 时推导为 noop', () => {
    const config = envOf({});
    expect(config.SCOUT_DRIVER).toBe('noop');
  });

  it('SCOUT_DRIVER: 未配置但有 SEARCH_URL 时推导为 meilisearch', () => {
    const config = envOf({ SEARCH_URL: 'meilisearch://masterKey@localhost:7700' });
    expect(config.SCOUT_DRIVER).toBe('meilisearch');
  });

  it('JWT_SECRET / MFA_ENCRYPTION_KEYS: 非生产未配置时回退开发默认值', () => {
    const config = envOf({});
    expect(config.JWT_SECRET).toBeTruthy();
    expect(config.MFA_ENCRYPTION_KEYS).toBeTruthy();
  });

  it('极简配置: 不提供任何变量时也可启动（全部走默认值）', () => {
    const config = envSchema.parse({});
    expect(config.APP_ENV).toBe('local');
    expect(config.APP_DEBUG).toBe(false);
    expect(config.PORT).toBe(4300);
    expect(config.APP_URL).toBe('http://localhost:4300');
    expect(config.DB_URL).toBe('postgresql://postgres:postgres@localhost:5432/nest-api');
    expect(config.FILESYSTEM_DISK).toBe('local');
    expect(config.SCOUT_DRIVER).toBe('noop');
    expect(config.HTTP_TIMEOUT_MS).toBe(15_000);
    expect(config.SWAGGER_ENABLED).toBe(true);
  });
});

describe('生产环境强制显式配置（禁止默认值兜底）', () => {
  const PROD_DB_URL = 'postgresql://app:secret@db:5432/nest_api';
  const PROD_JWT_SECRET = 'a-strong-production-jwt-secret-at-least-32-chars';
  const PROD_MFA_KEY = 'a-strong-production-mfa-key-at-least-32-chars';
  /** 生产环境基准字段：支付必须为 real 驱动，否则启动期拒绝（见下方专项用例） */
  const PROD_PAYMENT = {
    WEPAY_APPID: 'wx-prod-appid',
    WEPAY_MCHID: '1900000001',
    WEPAY_SERIAL_NO: 'SERIAL-NO',
    WEPAY_APIV3_KEY: 'a'.repeat(32),
    WEPAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
  };
  const PROD_OTP_KEY = 'o'.repeat(32);
  const PROD_BASE = {
    APP_ENV: 'production',
    MAIL_URL: 'smtp://mail.example.org:587',
    MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
    DB_URL: PROD_DB_URL,
    JWT_SECRET: PROD_JWT_SECRET,
    MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
    OTP_HMAC_KEY: PROD_OTP_KEY,
    ...PROD_PAYMENT,
  };

  it('缺少 DB_URL 时拒绝启动（不静默回退到 localhost）', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        JWT_SECRET: PROD_JWT_SECRET,
        MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
        ...PROD_PAYMENT,
      }),
    ).toThrow(/DB_URL/);
  });

  it('缺少 JWT_SECRET / MFA 密钥时拒绝启动（不使用公开默认密钥）', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        DB_URL: PROD_DB_URL,
        ...PROD_PAYMENT,
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('生产环境缺少 OTP_HMAC_KEY 时拒绝启动（验证码摘要不得回落到弱密钥）', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        DB_URL: PROD_DB_URL,
        JWT_SECRET: PROD_JWT_SECRET,
        MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
        ...PROD_PAYMENT,
      }),
    ).toThrow(/OTP_HMAC_KEY/);
  });

  it('生产环境显式指定 mock 支付驱动时拒绝启动', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        DB_URL: PROD_DB_URL,
        JWT_SECRET: PROD_JWT_SECRET,
        MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
        WEPAY_DRIVER: 'mock',
      }),
    ).toThrow(/mock/);
  });

  it('生产环境缺凭证隐式降级 mock 时拒绝启动（防漏配静默上线）', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        DB_URL: PROD_DB_URL,
        JWT_SECRET: PROD_JWT_SECRET,
        MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
      }),
    ).toThrow(/WEPAY_ALLOW_MOCK/);
  });

  it('显式退让后允许 mock 启动（未接入支付的部署不被阻断）', () => {
    const config = envSchema.parse({
      APP_ENV: 'production',
      MAIL_URL: 'smtp://mail.example.org:587',
      MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
      DB_URL: PROD_DB_URL,
      JWT_SECRET: PROD_JWT_SECRET,
      MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
      OTP_HMAC_KEY: PROD_OTP_KEY,
      WEPAY_ALLOW_MOCK: 'true',
    });
    expect(config.WEPAY_DRIVER).toBe('mock');
  });

  it('WEPAY_DRIVER=real 但凭证不完整时拒绝启动（否则运行期才报 401/解密失败）', () => {
    expect(() =>
      envSchema.parse({
        APP_ENV: 'production',
        MAIL_URL: 'smtp://mail.example.org:587',
        MAIL_FROM_ADDRESS: 'no-reply@nest-api.dev',
        DB_URL: PROD_DB_URL,
        JWT_SECRET: PROD_JWT_SECRET,
        MFA_ENCRYPTION_KEYS: PROD_MFA_KEY,
        WEPAY_DRIVER: 'real',
        // 只有私钥，缺 APIV3_KEY / APPID / MCHID / SERIAL_NO
        WEPAY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
      }),
    ).toThrow(/WEPAY_DRIVER=real/);
  });

  it('生产环境启用 IoT 且使用公开默认胡椒值时拒绝启动', () => {
    expect(() =>
      envSchema.parse({
        ...PROD_BASE,
        IOT_DEVICE_CREDENTIALS: 'device-01:secret-123456',
        IOT_DEVICE_PEPPER: 'nestforge-iot-device-pepper-v1',
      }),
    ).toThrow(/IOT_DEVICE_PEPPER/);
  });

  it('两项齐备（并含支付凭证）时正常通过', () => {
    const config = envSchema.parse(PROD_BASE);
    expect(config.DB_URL).toBe(PROD_DB_URL);
    expect(config.JWT_SECRET).toBe(PROD_JWT_SECRET);
    expect(config.MFA_ENCRYPTION_KEYS).toBe(PROD_MFA_KEY);
    expect(config.WEPAY_DRIVER).toBe('real');
  });

  it('非生产环境两项均可省略（回退本地默认值）', () => {
    const config = envSchema.parse({});
    expect(config.DB_URL).toContain('localhost:5432/nest-api');
    expect(config.JWT_SECRET).toBeTruthy();
  });

  it('显式配置为公开默认密钥时也拒绝启动（「已填」不等于「安全」）', () => {
    expect(() =>
      envSchema.parse({
        ...PROD_BASE,
        JWT_SECRET: 'nestforge-dev-only-jwt-secret-32-chars!!',
      }),
    ).toThrow(/公开默认密钥/);
  });
});

describe('旧 env 键拦截（更名迁移保护）', () => {
  it('残留 STORAGE_DRIVER 时拒绝启动，并提示改用 FILESYSTEM_DISK', () => {
    // 哨兵字段使拦截可经入参验证，无需篡改 process.env
    expect(() => envSchema.parse({ STORAGE_DRIVER: 'local' })).toThrow(/FILESYSTEM_DISK/);
  });

  it('残留 SEARCH_DRIVER 时拒绝启动，并提示改用 SCOUT_DRIVER', () => {
    expect(() => envSchema.parse({ SEARCH_DRIVER: 'noop' })).toThrow(/SCOUT_DRIVER/);
  });

  it('残留 BROADCAST_DRIVER 时拒绝启动（该键已删除）', () => {
    expect(() => envSchema.parse({ BROADCAST_DRIVER: 'centrifugo' })).toThrow(/REALTIME_URL/);
  });

  it('无旧键时不受影响', () => {
    expect(envSchema.parse({}).FILESYSTEM_DISK).toBe('local');
  });
});

describe('APP_NAME（品牌唯一来源）', () => {
  it('未配置时回退默认应用名，并作为 MAIL_FROM_NAME 的默认值', () => {
    const config = envOf({});
    expect(config.APP_NAME).toBe('nest-api');
    expect(config.MAIL_FROM_NAME).toBe('nest-api');
  });

  it('显式配置时尊重显式值（MAIL_FROM_NAME 显式覆盖仍优先）', () => {
    const config = envOf({ APP_NAME: 'acme-core', MAIL_FROM_NAME: 'Acme Notify' });
    expect(config.APP_NAME).toBe('acme-core');
    expect(config.MAIL_FROM_NAME).toBe('Acme Notify');
  });

  it('仅覆盖 APP_NAME 时，MAIL_FROM_NAME 同步跟随而不固化旧值', () => {
    const config = envOf({ APP_NAME: 'acme-core' });
    expect(config.APP_NAME).toBe('acme-core');
    expect(config.MAIL_FROM_NAME).toBe('acme-core');
  });

  it('空串视同未配置，回退默认应用名（与 appName() 语义一致）', () => {
    expect(envOf({ APP_NAME: '' }).APP_NAME).toBe('nest-api');
  });
});

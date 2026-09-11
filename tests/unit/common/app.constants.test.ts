import { describe, expect, it } from 'vitest';
import { APP_ENV_VALUES, isProductionEnv, PATHS } from '@/common/constants/app.constants';

describe('PATHS Constants', () => {
  it('全局路径常量应统一定义四大核心运行时目录', () => {
    expect(PATHS.STORAGE_ROOT).toBe('storage');
    expect(PATHS.STORAGE_UPLOADS).toBe('storage/uploads');
    expect(PATHS.STORAGE_LOGS).toBe('storage/logs');
    expect(PATHS.STORAGE_TMP).toBe('storage/tmp');
    expect(PATHS.STORAGE_CACHE).toBe('storage/cache');
  });

  it('API.md 和头像相对路径常量应正确定义', () => {
    expect(PATHS.API_MD_FILE).toBe('docs/api.md');
    expect(PATHS.AVATARS_RELATIVE_PATH).toBe('/uploads/avatars');
  });
});

describe('isProductionEnv', () => {
  it('当 APP_ENV 为 production 时返回 true', () => {
    const original = process.env.APP_ENV;
    process.env.APP_ENV = APP_ENV_VALUES.PRODUCTION;
    expect(isProductionEnv()).toBe(true);
    process.env.APP_ENV = original;
  });

  it('当 APP_ENV 不为 production 时返回 false', () => {
    const original = process.env.APP_ENV;
    process.env.APP_ENV = APP_ENV_VALUES.LOCAL;
    expect(isProductionEnv()).toBe(false);
    process.env.APP_ENV = original;
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { APP_ENV_VALUES, appName, DEFAULT_APP_NAME, isProductionEnv, PATHS } from '@/common/constants/app.constants';

describe('PATHS Constants', () => {
  it('全局路径常量应统一定义四大核心运行时目录', () => {
    expect(PATHS.STORAGE_ROOT).toBe('storage');
    expect(PATHS.STORAGE_UPLOADS).toBe('storage/uploads');
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

describe('appName（APP_NAME 品牌唯一来源）', () => {
  const original = process.env.APP_NAME;

  afterEach(() => {
    if (original === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = original;
  });

  it('未配置时回退默认应用名', () => {
    delete process.env.APP_NAME;
    expect(appName()).toBe(DEFAULT_APP_NAME);
    expect(DEFAULT_APP_NAME).toBe('nest-api');
  });

  it('空白值视为未配置，避免日志/发件人出现空白品牌', () => {
    process.env.APP_NAME = '   ';
    expect(appName()).toBe(DEFAULT_APP_NAME);
  });

  it('显式配置时去除首尾空白后原样返回', () => {
    process.env.APP_NAME = '  acme-core  ';
    expect(appName()).toBe('acme-core');
  });
});

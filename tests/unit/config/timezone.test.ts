import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, isTimezoneValid, setupTimezone } from '@/config/timezone';

describe('isTimezoneValid', () => {
  it('接受合法 IANA 时区（东八区）', () => {
    expect(isTimezoneValid('Asia/Shanghai')).toBe(true);
  });

  it('拒绝非法时区字符串', () => {
    expect(isTimezoneValid('Asia/Beijing')).toBe(false);
    expect(isTimezoneValid('not-a-tz')).toBe(false);
  });
});

describe('setupTimezone', () => {
  const originalEnv = process.env.APP_TIMEZONE;
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.APP_TIMEZONE;
    } else {
      process.env.APP_TIMEZONE = originalEnv;
    }
    process.env.TZ = originalTz;
  });

  it('配置合法时区时生效并写入 process.env.TZ', () => {
    process.env.APP_TIMEZONE = 'Asia/Tokyo';

    const timezone = setupTimezone();

    expect(timezone).toBe('Asia/Tokyo');
    expect(process.env.TZ).toBe('Asia/Tokyo');
  });

  it('未配置时回退默认东八区', () => {
    delete process.env.APP_TIMEZONE;

    const timezone = setupTimezone();

    expect(timezone).toBe(DEFAULT_TIMEZONE);
    expect(process.env.TZ).toBe(DEFAULT_TIMEZONE);
  });

  it('配置非法时区时回退默认东八区', () => {
    process.env.APP_TIMEZONE = 'Asia/Beijing';

    const timezone = setupTimezone();

    expect(timezone).toBe(DEFAULT_TIMEZONE);
    expect(process.env.TZ).toBe(DEFAULT_TIMEZONE);
  });
});

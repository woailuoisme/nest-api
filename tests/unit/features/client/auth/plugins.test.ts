import { describe, expect, it } from 'vitest';

import { auth } from '@/common/auth/better-auth';

/** 仅面向 JWT + REST API 后端保留的插件集合 */
const ACTIVE_PLUGIN_IDS = [
  'admin',
  'two-factor',
  'username',
  'phone-number',
  'email-otp',
  'last-login-method',
  'api-key',
  'bearer',
  'one-time-token',
  'jwt',
  'open-api',
];

/** 已移除插件：不得回归 */
const REMOVED_PLUGIN_IDS = [
  'passkey',
  'magic-link',
  'organization',
  'one-tap',
  'anonymous',
  'multi-session',
  'device-authorization',
  'sso',
  'i18n',
];

describe('Better Auth 插件装配', () => {
  it('应装配全部在用的 API 鉴权插件', () => {
    const pluginIds = (auth.options.plugins || []).map((p) => p.id);

    for (const id of ACTIVE_PLUGIN_IDS) {
      expect(pluginIds).toContain(id);
    }
  });

  it('已移除的浏览器/企业场景插件不得回归', () => {
    const pluginIds = (auth.options.plugins || []).map((p) => p.id);

    for (const id of REMOVED_PLUGIN_IDS) {
      expect(pluginIds).not.toContain(id);
    }
  });

  it('手机号发码前先校验号码归属地：非法号码返回 400 而非落库后 5xx', () => {
    const phonePlugin = (auth.options.plugins || []).find((p) => p.id === 'phone-number') as
      | { options?: { phoneNumberValidator?: (phone: string) => unknown } }
      | undefined;
    const validator = phonePlugin?.options?.phoneNumberValidator;

    // 缺少 validator 时 Better Auth 会先写 verification 行再调用 sendOTP，非法号码无法被拦下
    expect(validator, 'phoneNumber 插件未装配 phoneNumberValidator').toBeTypeOf('function');
    expect(validator?.('+8613800138000')).toBe(true);
    expect(validator?.('13800138000')).toBe(true);
    expect(validator?.('+15551234567')).toBe(false);
    expect(validator?.('12345')).toBe(false);
  });
});

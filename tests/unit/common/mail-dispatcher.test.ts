import { afterEach, describe, expect, it, vi } from 'vitest';

import { authMailHandlers } from '@/common/auth/mail-dispatcher';

describe('authMailHandlers — 无调度器时的降级策略', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('生产环境不得把 OTP 写进日志', async () => {
    vi.stubEnv('APP_ENV', 'production');

    await expect(authMailHandlers.sendVerificationOTP({ email: 'a@b.com', otp: '123456' })).rejects.toThrow(
      /调度器未注册/,
    );
  });

  it('生产环境不得把重置令牌链接写进日志', async () => {
    vi.stubEnv('APP_ENV', 'production');

    await expect(
      authMailHandlers.sendResetPassword({
        user: { email: 'a@b.com', name: 'A' },
        url: 'https://x/reset?token=t',
        token: 't',
      }),
    ).rejects.toThrow(/调度器未注册/);
  });

  it('开发环境允许日志降级（不抛错）', async () => {
    vi.stubEnv('APP_ENV', 'local');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(authMailHandlers.sendVerificationOTP({ email: 'a@b.com', otp: '123456' })).resolves.toBeUndefined();

    logSpy.mockRestore();
  });
});

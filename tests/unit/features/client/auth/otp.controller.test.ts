import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { OtpService } from '@/common/auth/otp.service';
import type { UsersRepository } from '@/common/auth/users.repository';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { OtpController } from '@/features/client/auth/otp.controller';

const user = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  role: 'USER',
} as unknown as CurrentUserPayload;

function createController() {
  const otpService = {
    sendEmailCode: vi.fn().mockResolvedValue(undefined),
    verifyEmailCode: vi.fn().mockResolvedValue(true),
    sendSmsCode: vi.fn().mockResolvedValue(undefined),
    verifySmsCode: vi.fn().mockResolvedValue(true),
    normalizePhone: vi.fn((raw: string) => raw.replace(/\D/g, '').slice(-11)),
  } as unknown as OtpService;

  const usersRepository = {
    markEmailVerified: vi.fn().mockResolvedValue(true),
    setPhoneNumber: vi.fn().mockResolvedValue(user),
  } as unknown as UsersRepository;

  return { controller: new OtpController(otpService, usersRepository), otpService, usersRepository };
}

describe('OtpController', () => {
  it('发送邮箱验证码应回 202 语义并给出有效期', async () => {
    const { controller, otpService } = createController();

    await expect(controller.sendEmailCode(user)).resolves.toEqual({ sent: true, expiresInSeconds: 300 });
    expect(otpService.sendEmailCode).toHaveBeenCalledWith({ userId: 'user-1', email: 'ada@example.com', name: 'Ada' });
  });

  it('邮箱验证码校验成功后应标记邮箱已验证', async () => {
    const { controller, usersRepository } = createController();

    await expect(controller.verifyEmailCode(user, { code: '123456' })).resolves.toEqual({ emailVerified: true });
    expect(usersRepository.markEmailVerified).toHaveBeenCalledWith('user-1', 'ada@example.com');
  });

  it('邮箱验证码错误应抛 401 且不改动用户', async () => {
    const { controller, otpService, usersRepository } = createController();
    vi.mocked(otpService.verifyEmailCode).mockResolvedValue(false);

    await expect(controller.verifyEmailCode(user, { code: '000000' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersRepository.markEmailVerified).not.toHaveBeenCalled();
  });

  it('手机验证码校验成功后应复用服务层归一化结果绑定', async () => {
    const { controller, otpService, usersRepository } = createController();

    await expect(controller.verifyPhoneCode(user, { phoneNumber: '+8613800138000', code: '123456' })).resolves.toEqual({
      phoneVerified: true,
    });
    expect(otpService.normalizePhone).toHaveBeenCalledWith('+8613800138000');
    expect(usersRepository.setPhoneNumber).toHaveBeenCalledWith('user-1', '13800138000');
  });
});

/**
 * AuthService 单元测试
 *
 * 覆盖：注册/登录、OAuth 验证、忘记/重置密码、邮箱验证
 */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/api/client/auth/auth.service';
import { AuthTokenManager } from '@/api/client/auth/auth-token.manager';
import { DRIZZLE_DB } from '@/database/drizzle/drizzle.service';
import { MailJobs } from '@/queues/mail/mail.jobs';

/** 模拟 Hash 工具：避免真实 argon2 计算 */
vi.mock('@/common/utils/hash.util', () => ({
  Hash: {
    make: vi.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
    check: vi.fn((plain: string, hash: string) => Promise.resolve(hash === `hashed:${plain}`)),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;
  let db: ReturnType<typeof createMockDrizzleDb>;
  let mailQueue: {
    queueVerificationEmail: ReturnType<typeof vi.fn>;
    queuePasswordResetEmail: ReturnType<typeof vi.fn>;
    queueWelcomeEmail: ReturnType<typeof vi.fn>;
  };
  let authTokenManager: {
    issueTokenPair: ReturnType<typeof vi.fn>;
    issueEphemeralToken: ReturnType<typeof vi.fn>;
    consumeEphemeralToken: ReturnType<typeof vi.fn>;
    revokeAllForUser: ReturnType<typeof vi.fn>;
    rotateRefreshToken: ReturnType<typeof vi.fn>;
    revokeRefreshToken: ReturnType<typeof vi.fn>;
  };

  const mockUser = {
    id: 1,
    name: '测试用户',
    email: 'test@example.com',
    role: 'USER',
    passwordHash: 'hashed:Password123',
    emailVerifiedAt: new Date('2024-01-01'),
  };

  const mockTokenPair = { accessToken: 'mock-access', refreshToken: 'mock-refresh' };

  beforeEach(async () => {
    db = createMockDrizzleDb();

    mailQueue = {
      queueVerificationEmail: vi.fn().mockResolvedValue(undefined),
      queuePasswordResetEmail: vi.fn().mockResolvedValue(undefined),
      queueWelcomeEmail: vi.fn().mockResolvedValue(undefined),
    };

    authTokenManager = {
      issueTokenPair: vi.fn().mockResolvedValue(mockTokenPair),
      issueEphemeralToken: vi.fn().mockResolvedValue({
        rawToken: 'mock-raw-token',
        tokenHash: 'mock-token-hash',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      consumeEphemeralToken: vi.fn().mockResolvedValue({ userId: 1 }),
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
      rotateRefreshToken: vi.fn().mockResolvedValue(mockTokenPair),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE_DB, useValue: db },
        { provide: MailJobs, useValue: mailQueue },
        { provide: AuthTokenManager, useValue: authTokenManager },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  describe('register() — 用户注册', () => {
    const registerDto = {
      name: '新用户',
      email: 'new@example.com',
      password: 'StrongPass1',
    };

    it('应成功注册新用户并返回令牌对', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...registerDto }]);

      const result = await authService.register(registerDto);

      expect(result).toEqual(mockTokenPair);
      expect(authTokenManager.issueEphemeralToken).toHaveBeenCalledWith('email_verification', mockUser.id, 24);
      expect(authTokenManager.issueTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockUser.id, email: registerDto.email, role: 'USER' }),
      );
    });

    it('应使用哈希后的密码存储', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...registerDto }]);

      await authService.register(registerDto);

      const createData = db._stubs.insertValues.mock.calls[0][0];
      expect(createData.passwordHash).toBe('hashed:StrongPass1');
    });

    it('应发送邮箱验证邮件', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...registerDto }]);

      await authService.register(registerDto);

      expect(mailQueue.queueVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('注册时不应发送欢迎邮件（延后至邮箱验证通过）', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...registerDto }]);

      await authService.register(registerDto);

      expect(mailQueue.queueWelcomeEmail).not.toHaveBeenCalled();
      expect(mailQueue.queueVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('邮箱已存在时应抛出 ConflictException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      await expect(authService.register(registerDto)).rejects.toBeInstanceOf(ConflictException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('login() — 用户登录', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'Password123',
    };

    it('正确的凭据应返回令牌对', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await authService.login(loginDto);

      expect(result).toEqual(mockTokenPair);
      expect(authTokenManager.issueTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockUser.id, email: mockUser.email, role: mockUser.role }),
      );
    });

    it('邮箱不存在时应抛出 UnauthorizedException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      await expect(authService.login({ email: 'test@example.com', password: 'WrongPassword1' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('用户无密码哈希（仅 OAuth 注册）时应抛出 UnauthorizedException', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ ...mockUser, passwordHash: null });

      await expect(authService.login(loginDto)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('validateOAuthLogin() — OAuth 登录验证', () => {
    const oauthProfile = {
      provider: 'google' as const,
      providerUserId: 'google-12345',
      email: 'oauth@example.com',
      name: 'OAuth 用户',
    };

    it('已关联的 OAuth 账户应直接返回令牌', async () => {
      db._stubs.findFirstOAuth.mockResolvedValue({
        user: mockUser,
      });

      const result = await authService.validateOAuthLogin(oauthProfile);

      expect(result).toEqual(mockTokenPair);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('新 OAuth 用户应在事务中自动创建账户并关联', async () => {
      db._stubs.findFirstOAuth.mockResolvedValue(null);
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning
        .mockResolvedValueOnce([{ ...mockUser, id: 2, email: oauthProfile.email, name: oauthProfile.name }])
        .mockResolvedValueOnce([{ id: 1 }]);

      const result = await authService.validateOAuthLogin(oauthProfile);

      expect(result).toEqual(mockTokenPair);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(2);
    });

    it('已存在但邮箱未验证的用户应拒绝 OAuth 绑定（防账户接管）', async () => {
      db._stubs.findFirstOAuth.mockResolvedValue(null);
      db._stubs.findFirstUser.mockResolvedValue({ ...mockUser, emailVerifiedAt: null });

      await expect(authService.validateOAuthLogin(oauthProfile)).rejects.toBeInstanceOf(ConflictException);
      expect(authTokenManager.issueTokenPair).not.toHaveBeenCalled();
    });

    it('已存在且邮箱已验证的用户应关联 OAuth 而不创建新用户', async () => {
      db._stubs.findFirstOAuth.mockResolvedValue(null);
      db._stubs.findFirstUser.mockResolvedValue({ ...mockUser, emailVerifiedAt: new Date() });
      db._stubs.insertReturning.mockResolvedValue([{ id: 1 }]);

      const result = await authService.validateOAuthLogin(oauthProfile);

      expect(result).toEqual(mockTokenPair);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshToken() — 刷新 Token', () => {
    it('应委托 AuthTokenManager.rotateRefreshToken 处理', async () => {
      authTokenManager.rotateRefreshToken.mockResolvedValue(mockTokenPair);

      const result = await authService.refreshToken('raw-token');

      expect(authTokenManager.rotateRefreshToken).toHaveBeenCalledWith('raw-token');
      expect(result).toEqual(mockTokenPair);
    });
  });

  describe('logout() — 注销登录', () => {
    it('应委托 AuthTokenManager.revokeRefreshToken 处理', async () => {
      authTokenManager.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await authService.logout('raw-token');

      expect(authTokenManager.revokeRefreshToken).toHaveBeenCalledWith('raw-token');
      expect(result).toBeUndefined();
    });
  });

  describe('forgotPassword() — 忘记密码', () => {
    const email = 'test@example.com';

    it('用户存在时应创建重置令牌并发送邮件', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await authService.forgotPassword(email);

      expect(result).toBeUndefined();
      expect(authTokenManager.issueEphemeralToken).toHaveBeenCalledWith('password_reset', mockUser.id, 1);
      expect(mailQueue.queuePasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('用户不存在时应返回通用响应（防止邮箱枚举）', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      const result = await authService.forgotPassword(email);

      expect(result).toBeUndefined();
      expect(authTokenManager.issueEphemeralToken).not.toHaveBeenCalled();
      expect(mailQueue.queuePasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword() — 重置密码', () => {
    const rawToken = 'reset-token-raw';
    const newPassword = 'NewStrongPass1';

    it('有效令牌应重置密码并在事务中撤销所有令牌', async () => {
      authTokenManager.consumeEphemeralToken.mockResolvedValue({ userId: 1 });
      db._stubs.updateWhere.mockResolvedValue([mockUser]);

      const result = await authService.resetPassword(rawToken, newPassword);

      expect(result).toBeUndefined();
      expect(authTokenManager.consumeEphemeralToken).toHaveBeenCalledWith('password_reset', rawToken, db);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(authTokenManager.revokeAllForUser).toHaveBeenCalledWith(1, db);
      expect(db.update).toHaveBeenCalled();
    });

    it('令牌无效/已使用/过期时应直接抛出 UnauthorizedException', async () => {
      authTokenManager.consumeEphemeralToken.mockRejectedValue(
        new UnauthorizedException('Invalid or expired reset token'),
      );

      await expect(authService.resetPassword('invalid-token', newPassword)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail() — 邮箱验证', () => {
    const rawToken = 'verify-token-raw';

    it('有效令牌应验证邮箱并补发欢迎邮件', async () => {
      authTokenManager.consumeEphemeralToken.mockResolvedValue({ userId: 1 });
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await authService.verifyEmail(rawToken);

      expect(result).toBeUndefined();
      expect(authTokenManager.consumeEphemeralToken).toHaveBeenCalledWith('email_verification', rawToken, db);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db.update).toHaveBeenCalled();
      expect(mailQueue.queueWelcomeEmail).toHaveBeenCalledWith(mockUser.email, mockUser.name, 'zh');
    });

    it('令牌无效/已使用/过期时应直接抛出 UnauthorizedException', async () => {
      authTokenManager.consumeEphemeralToken.mockRejectedValue(
        new UnauthorizedException('Invalid or expired verification code'),
      );

      await expect(authService.verifyEmail('invalid-token')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(db.update).not.toHaveBeenCalled();
    });
  });
});

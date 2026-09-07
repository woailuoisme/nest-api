/**
 * AuthController 单元测试
 *
 * 覆盖：注册/登录/刷新/注销/忘记密码/重置密码/邮箱验证/OAuth 回调
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '@/api/client/auth/auth.controller';
import { AuthService } from '@/api/client/auth/auth.service';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: {
    register: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    validateOAuthLogin: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    forgotPassword: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
    verifyEmail: ReturnType<typeof vi.fn>;
  };

  const mockTokenPair = { accessToken: 'token-a', refreshToken: 'token-r' };

  beforeEach(async () => {
    authService = {
      register: vi.fn().mockResolvedValue(mockTokenPair),
      login: vi.fn().mockResolvedValue(mockTokenPair),
      validateOAuthLogin: vi.fn().mockResolvedValue(mockTokenPair),
      refreshToken: vi.fn().mockResolvedValue(mockTokenPair),
      logout: vi.fn().mockResolvedValue(undefined),
      forgotPassword: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
      verifyEmail: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    authController = module.get(AuthController);
  });

  describe('POST /auth/register — 用户注册', () => {
    it('应调用 AuthService.register 并返回令牌对', async () => {
      const dto = { name: '张三', email: 'test@example.com', password: 'Password123' };
      const result = await authController.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTokenPair);
    });
  });

  describe('POST /auth/login — 用户登录', () => {
    it('应调用 AuthService.login 并返回令牌对', async () => {
      const dto = { email: 'test@example.com', password: 'Password123' };
      const result = await authController.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTokenPair);
    });
  });

  describe('POST /auth/refresh — 刷新令牌', () => {
    it('应调用 AuthService.refreshToken 并返回新令牌对', async () => {
      const dto = { refreshToken: 'old-refresh-token' };
      const result = await authController.refresh(dto);

      expect(authService.refreshToken).toHaveBeenCalledWith('old-refresh-token');
      expect(result).toEqual(mockTokenPair);
    });
  });

  describe('POST /auth/logout — 注销登录', () => {
    it('应调用 AuthService.logout 撤销刷新令牌', async () => {
      const dto = { refreshToken: 'token-to-revoke' };
      const result = await authController.logout(dto);

      expect(authService.logout).toHaveBeenCalledWith('token-to-revoke');
      expect(result).toBeUndefined();
    });
  });

  describe('POST /auth/forgot-password — 忘记密码', () => {
    it('应调用 AuthService.forgotPassword 发送重置邮件', async () => {
      const dto = { email: 'test@example.com' };
      const result = await authController.forgotPassword(dto);

      expect(authService.forgotPassword).toHaveBeenCalledWith('test@example.com', 'zh');
      expect(result).toBeUndefined();
    });
  });

  describe('POST /auth/reset-password — 重置密码', () => {
    it('应调用 AuthService.resetPassword 重置密码', async () => {
      const dto = { token: 'reset-token', password: 'NewPass123' };
      const result = await authController.resetPassword(dto);

      expect(authService.resetPassword).toHaveBeenCalledWith('reset-token', 'NewPass123');
      expect(result).toBeUndefined();
    });
  });

  describe('GET /auth/verify-email — 邮箱验证', () => {
    it('应调用 AuthService.verifyEmail 验证邮箱', async () => {
      const result = await authController.verifyEmail({ token: 'verify-token-value' });

      expect(authService.verifyEmail).toHaveBeenCalledWith('verify-token-value');
      expect(result).toBeUndefined();
    });
  });

  describe('GET /auth/google/callback — Google OAuth 回调', () => {
    it('应调用 AuthService.validateOAuthLogin 处理 Google 回调', async () => {
      const oauthProfile = {
        provider: 'google' as const,
        providerUserId: 'g-123',
        email: 'g@test.com',
        name: 'G User',
      };
      const req = { user: oauthProfile } as any;

      const result = await authController.googleCallback(req);

      expect(authService.validateOAuthLogin).toHaveBeenCalledWith(oauthProfile);
      expect(result).toEqual(mockTokenPair);
    });
  });

  describe('GET /auth/google — Google 登录重定向', () => {
    it('应正常返回（guard 负责重定向）', () => {
      expect(() => authController.googleLogin()).not.toThrow();
    });
  });
});

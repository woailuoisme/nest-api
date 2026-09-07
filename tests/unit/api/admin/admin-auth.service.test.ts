import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthService } from '@/api/admin/auth/admin-auth.service';
import { AdminRole, AdminStatus } from '@/common/constants/roles';
import { Hash } from '@/common/utils/hash.util';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let mockDb: any;
  let mockJwtService: Partial<JwtService>;
  let mockConfigService: Partial<ConfigService>;

  const mockAdmin = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@example.com',
    passwordHash: '',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
    avatarUrl: null,
    lastLoginAt: new Date('2026-01-01'),
    lastLoginIp: '127.0.0.1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    mockAdmin.passwordHash = await Hash.make('admin123456');

    mockDb = {
      query: {
        adminUsers: {
          findFirst: vi.fn(),
        },
      },
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ adminUserId: 1 }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
    };

    mockJwtService = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
        if (key === 'JWT_ACCESS_EXPIRES_IN') return '15m';
        if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return '';
      }),
    };

    service = new AdminAuthService(
      mockDb as any,
      mockJwtService as JwtService,
      mockConfigService as ConfigService<any, true>,
    );
  });

  describe('login', () => {
    it('正确凭据时应成功登录并签发 token', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      const result = await service.login({ email: 'admin@example.com', password: 'admin123456' }, '1.2.3.4');

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');
      expect(result.admin.email).toBe('admin@example.com');
      expect(result.admin.role).toBe(AdminRole.SUPER_ADMIN);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      await expect(service.login({ email: 'admin@example.com', password: 'wrong-password' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('管理员账号不存在时应抛出 UnauthorizedException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(null);

      await expect(service.login({ email: 'unknown@example.com', password: 'admin123456' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('管理员账号已被禁用 (DISABLED) 时应抛出 UnauthorizedException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue({
        ...mockAdmin,
        status: AdminStatus.DISABLED,
      });

      await expect(service.login({ email: 'admin@example.com', password: 'admin123456' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshToken', () => {
    it('合法未过期 Refresh Token 应成功轮换', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      const result = await service.refreshToken('valid-refresh-token');

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.admin.id).toBe(1);
    });
  });

  describe('logout', () => {
    it('登出时应调用 update 标记 token 吊销', async () => {
      await service.logout('some-token');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('获取个人信息应返回管理员资料', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      const profile = await service.getProfile(1);
      expect(profile.id).toBe(1);
      expect(profile.email).toBe('admin@example.com');
    });

    it('账号不存在时应抛出 UnauthorizedException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(null);

      await expect(service.getProfile(999)).rejects.toThrow(UnauthorizedException);
    });
  });
});

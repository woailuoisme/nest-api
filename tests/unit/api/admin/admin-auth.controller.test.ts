import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthController } from '@/api/admin/auth/admin-auth.controller';
import { AdminAuthService } from '@/api/admin/auth/admin-auth.service';
import { AdminRole, AdminStatus } from '@/common/constants/roles';

describe('AdminAuthController', () => {
  let controller: AdminAuthController;
  let adminAuthService: {
    login: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
  };

  const mockProfile = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@example.com',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
    avatarUrl: null,
    lastLoginAt: '2026-01-01T00:00:00.000Z',
  };

  const mockTokenPair = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    admin: mockProfile,
  };

  beforeEach(async () => {
    adminAuthService = {
      login: vi.fn().mockResolvedValue(mockTokenPair),
      refreshToken: vi.fn().mockResolvedValue(mockTokenPair),
      logout: vi.fn().mockResolvedValue(undefined),
      getProfile: vi.fn().mockResolvedValue(mockProfile),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [{ provide: AdminAuthService, useValue: adminAuthService }],
    }).compile();

    controller = module.get(AdminAuthController);
  });

  it('login 应调用 adminAuthService.login 并透传客户端 IP', async () => {
    const dto = { email: 'admin@example.com', password: 'password123' };
    const mockReq = { ip: '192.168.1.1' } as any;
    const result = await controller.login(dto, mockReq);

    expect(adminAuthService.login).toHaveBeenCalledWith(dto, '192.168.1.1');
    expect(result).toEqual(mockTokenPair);
  });

  it('refresh 应调用 adminAuthService.refreshToken 轮换令牌', async () => {
    const dto = { refreshToken: 'mock-refresh-token' };
    const result = await controller.refresh(dto);

    expect(adminAuthService.refreshToken).toHaveBeenCalledWith('mock-refresh-token');
    expect(result).toEqual(mockTokenPair);
  });

  it('logout 应调用 adminAuthService.logout 吊销令牌', async () => {
    const dto = { refreshToken: 'mock-refresh-token' };
    await controller.logout(dto);

    expect(adminAuthService.logout).toHaveBeenCalledWith('mock-refresh-token');
  });

  it('getProfile 应调用 adminAuthService.getProfile 获取当前管理员信息', async () => {
    const result = await controller.getProfile(1);

    expect(adminAuthService.getProfile).toHaveBeenCalledWith(1);
    expect(result).toEqual(mockProfile);
  });
});

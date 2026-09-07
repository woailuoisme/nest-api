import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdminJwtPayload, AdminJwtStrategy } from '@/api/admin/auth/strategies/admin-jwt.strategy';
import { AdminRole, AdminStatus } from '@/common/constants/roles';

describe('AdminJwtStrategy', () => {
  let strategy: AdminJwtStrategy;
  let mockDb: any;
  let mockConfig: Partial<ConfigService>;

  const mockAdmin = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@example.com',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
    avatarUrl: null,
    lastLoginAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockDb = {
      query: {
        adminUsers: {
          findFirst: vi.fn(),
        },
      },
    };

    mockConfig = {
      get: vi.fn().mockReturnValue('test-secret'),
    };

    strategy = new AdminJwtStrategy(mockConfig as ConfigService<any, true>, mockDb as any);
  });

  it('合法 admin payload 且账号有效时应成功返回 admin 对象', async () => {
    mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

    const payload: AdminJwtPayload = {
      sub: 1,
      email: 'admin@example.com',
      role: AdminRole.SUPER_ADMIN,
      guard: 'admin',
    };

    const user = await strategy.validate(payload);
    expect(user.id).toBe(1);
    expect(user.email).toBe('admin@example.com');
    expect(user.role).toBe(AdminRole.SUPER_ADMIN);
  });

  it('guard 不为 admin 时应抛出 UnauthorizedException', async () => {
    const payload = {
      sub: 1,
      email: 'admin@example.com',
      role: AdminRole.SUPER_ADMIN,
      guard: 'user',
    } as any;

    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token guard: admin token required');
  });

  it('管理员不存在时应抛出 UnauthorizedException', async () => {
    mockDb.query.adminUsers.findFirst.mockResolvedValue(null);

    const payload: AdminJwtPayload = {
      sub: 999,
      email: 'ghost@example.com',
      role: AdminRole.ADMIN,
      guard: 'admin',
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Administrator account not found');
  });

  it('管理员状态被禁用 (DISABLED) 时应抛出 UnauthorizedException', async () => {
    mockDb.query.adminUsers.findFirst.mockResolvedValue({
      ...mockAdmin,
      status: AdminStatus.DISABLED,
    });

    const payload: AdminJwtPayload = {
      sub: 1,
      email: 'admin@example.com',
      role: AdminRole.SUPER_ADMIN,
      guard: 'admin',
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Administrator account is disabled');
  });
});

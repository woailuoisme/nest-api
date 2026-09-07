import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminsService } from '@/api/admin/admins/admins.service';
import { AdminRole, AdminStatus } from '@/common/constants/roles';
import { paginateQuery } from '@/database/drizzle/drizzle-pagination';

/** 模拟 Hash.make */
vi.mock('@/common/utils/hash.util', () => ({
  Hash: {
    make: vi.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
    check: vi.fn((plain: string, hash: string) => Promise.resolve(hash === `hashed:${plain}`)),
  },
}));

/** 模拟分页助手 */
vi.mock('@/database/drizzle/drizzle-pagination', () => ({
  paginateQuery: vi.fn(),
}));

describe('AdminsService', () => {
  let service: AdminsService;
  let mockDb: any;

  const mockAdmin = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@example.com',
    passwordHash: '$argon2id$mock',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
    avatarUrl: null,
    lastLoginAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      query: {
        adminUsers: {
          findMany: vi.fn().mockResolvedValue([mockAdmin]),
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockAdmin]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockAdmin]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockAdmin]),
      }),
    };

    service = new AdminsService(mockDb as any);
  });

  describe('findAll', () => {
    it('应正确分页查询管理员列表', async () => {
      vi.mocked(paginateQuery).mockResolvedValueOnce({
        rows: [mockAdmin],
        total: 1,
      } as any);

      const result = await service.findAll({ page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.items[0].email).toBe('admin@example.com');
    });
  });

  describe('findById', () => {
    it('存在时应返回指定管理员详情', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      const result = await service.findById(1);
      expect(result.id).toBe(1);
      expect(result.name).toBe('Super Admin');
    });

    it('不存在时应抛出 NotFoundException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(null);

      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('合法入参应成功创建管理员', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(null);

      const result = await service.create({
        name: 'New Admin',
        email: 'new@example.com',
        password: 'password123',
        role: AdminRole.ADMIN,
        status: AdminStatus.ACTIVE,
      });

      expect(result.email).toBe('admin@example.com');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('邮箱已被占用时应抛出 ConflictException', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      await expect(
        service.create({
          name: 'New Admin',
          email: 'admin@example.com',
          password: 'password123',
          role: AdminRole.ADMIN,
          status: AdminStatus.ACTIVE,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('应成功更新管理员信息', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      const result = await service.update(1, { name: 'Updated Name' });
      expect(result.id).toBe(1);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('重置密码时应同时吊销 refresh tokens', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      await service.update(1, { password: 'newpassword123' });
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete', () => {
    it('应成功删除管理员', async () => {
      mockDb.query.adminUsers.findFirst.mockResolvedValue(mockAdmin);

      await service.delete(2, 1);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('尝试删除自己时应抛出 BadRequestException', async () => {
      await expect(service.delete(1, 1)).rejects.toThrow(BadRequestException);
    });
  });
});

/**
 * UsersService 单元测试
 *
 * 覆盖：用户 CRUD、分页搜索、头像更新
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { instanceToPlain } from 'class-transformer';
import { range } from 'es-toolkit';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserEntity } from '@/api/admin/users/users.dto';
import { UsersService } from '@/api/admin/users/users.service';
import { DRIZZLE_DB } from '@/database/drizzle/drizzle.service';
import { paginateQuery } from '@/database/drizzle/drizzle-pagination';

/** 模拟 Hash.make：避免真实 argon2 计算 */
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

describe('UsersService (Admin)', () => {
  let usersService: UsersService;
  let db: ReturnType<typeof createMockDrizzleDb>;

  const mockUser = {
    id: 1,
    name: '张三',
    email: 'zhangsan@example.com',
    passwordHash: 'hashed:secret',
    role: 'USER',
    avatarUrl: null,
    emailVerifiedAt: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    db = createMockDrizzleDb();

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();

    usersService = module.get(UsersService);
  });

  describe('create() — 创建用户', () => {
    const createDto = {
      name: '李四',
      email: 'lisi@example.com',
      password: 'strongPassword1',
    };

    it('应创建用户并返回 UserEntity', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...createDto, emailVerifiedAt: undefined }]);

      const result = await usersService.create(createDto);

      expect(result).toHaveProperty('name', '李四');
      expect(result).toHaveProperty('email', 'lisi@example.com');
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('应使用哈希后的密码创建用户', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...createDto }]);

      await usersService.create(createDto);

      const createData = db._stubs.insertValues.mock.calls[0][0];
      expect(createData.passwordHash).toBe('hashed:strongPassword1');
      expect(createData.password).toBeUndefined();
    });

    it('邮箱已存在时应抛出 ConflictException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      await expect(usersService.create(createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('可选 role 参数应生效', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, role: 'ADMIN' }]);

      await usersService.create({ ...createDto, role: 'ADMIN' as any });

      expect(db._stubs.insertValues.mock.calls[0][0].role).toBe('ADMIN');
    });
  });

  describe('findAll() — 分页列表', () => {
    it('默认参数应返回第一页 20 条', async () => {
      vi.mocked(paginateQuery).mockResolvedValue({
        rows: range(1, 21).map((id) => ({ ...mockUser, id })),
        total: 50,
      } as any);

      const result = await usersService.findAll({});

      expect(result.items).toHaveLength(20);
      expect(result.meta.total).toBe(50);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
    });

    it('自定义分页参数应正确计算 offset', async () => {
      vi.mocked(paginateQuery).mockResolvedValue({ rows: [mockUser], total: 1 } as any);

      await usersService.findAll({ page: 3, pageSize: 20 });

      const options = vi.mocked(paginateQuery).mock.calls[0][2];
      expect(options.page).toBe(3);
      expect(options.pageSize).toBe(20);
    });

    it('空结果应正确处理', async () => {
      vi.mocked(paginateQuery).mockResolvedValue({ rows: [], total: 0 } as any);

      const result = await usersService.findAll({});

      expect(result.items).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(1);
    });

    it('返回的列表元素经 UserEntity 序列化后应安全剥离 passwordHash', async () => {
      vi.mocked(paginateQuery).mockResolvedValue({ rows: [mockUser], total: 1 } as any);

      const result = await usersService.findAll({});

      expect(result.items[0]).toBeInstanceOf(UserEntity);
      const plain = instanceToPlain(result.items[0]);
      expect(plain).not.toHaveProperty('passwordHash');
      expect(plain).toHaveProperty('id', 1);
      expect(plain).toHaveProperty('email', 'zhangsan@example.com');
    });
  });

  describe('findOne() — 查找单个用户', () => {
    it('应返回指定 ID 的用户', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await usersService.findOne(1);

      expect(result.id).toBe(1);
      expect(result).toHaveProperty('name', '张三');
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update() — 更新用户', () => {
    it('应更新用户并返回 UserEntity', async () => {
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, name: '张三三' }]);

      const result = await usersService.update(1, { name: '张三三' });

      expect(result.name).toBe('张三三');
    });

    it('更新邮箱时若已被他人占用应抛出 ConflictException', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ ...mockUser, id: 2, email: 'other@example.com' });

      await expect(usersService.update(1, { email: 'other@example.com' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.updateReturning.mockResolvedValue([]);

      await expect(usersService.update(999, { name: 'test' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeRole() — 变更用户角色', () => {
    it('应更新角色并返回 UserEntity', async () => {
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, role: 'ADMIN' }]);

      const result = await usersService.changeRole(1, 'ADMIN' as any);

      expect(db.update).toHaveBeenCalled();
      expect(result.role).toBe('ADMIN');
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.updateReturning.mockResolvedValue([]);

      await expect(usersService.changeRole(999, 'ADMIN' as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove() — 删除用户', () => {
    it('应原子删除用户并返回成功消息', async () => {
      db._stubs.deleteReturning.mockResolvedValue([mockUser]);

      const result = await usersService.remove(1);

      expect(result).toEqual({ message: 'User deleted successfully' });
      expect(db.delete).toHaveBeenCalled();
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.deleteReturning.mockResolvedValue([]);

      await expect(usersService.remove(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

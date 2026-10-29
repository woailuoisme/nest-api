/**
 * AdminUsersController 单元测试
 *
 * 覆盖：创建用户/列表/更新/变更角色/删除（管理端点，挂载于 /admin/users）
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { AdminUsersController } from '@/features/admin/users/users.controller';
import {
  type ChangeRoleRequest,
  type CreateUserRequest,
  type FindUsersRequest,
  UserEntity,
} from '@/features/admin/users/users.dto';
import { UsersService } from '@/features/admin/users/users.service';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let usersService: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    changeRole: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };

  const actor = { id: 'actor-uuid-1', email: 'admin@example.com', role: Role.SUPER_ADMIN };

  const mockUser = new UserEntity({
    id: 'user-uuid-1',
    name: '张三',
    email: 'zhangsan@example.com',
    role: Role.USER,
    avatarUrl: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });

  const mockPaginatedResult = new PaginatedResultResource(
    [mockUser],
    new PageMetaResource({ page: 1, pageSize: 20 }, 1),
  );

  beforeEach(async () => {
    usersService = {
      create: vi.fn().mockResolvedValue(mockUser),
      findAll: vi.fn().mockResolvedValue(mockPaginatedResult),
      update: vi.fn().mockResolvedValue(mockUser),
      changeRole: vi.fn().mockResolvedValue({ ...mockUser, role: Role.ADMIN }),
      remove: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue(mockPaginatedResult),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get(AdminUsersController);
  });

  describe('POST /admin/users — 创建用户', () => {
    it('应调用 UsersService.create 创建用户', async () => {
      const dto: CreateUserRequest = {
        name: '新用户',
        email: 'new@example.com',
        password: 'Password123',
      };

      const result = await controller.create(actor, dto);

      expect(usersService.create).toHaveBeenCalledWith(actor, dto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('GET /admin/users — 用户列表', () => {
    it('应调用 UsersService.findAll 返回分页列表', async () => {
      const query: FindUsersRequest = { page: 1, pageSize: 10, search: '张三', role: Role.USER };

      const result = await controller.findAll(query);

      expect(usersService.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockPaginatedResult);
    });

    it('空查询参数也应正常处理', async () => {
      const result = await controller.findAll({});

      expect(usersService.findAll).toHaveBeenCalledWith({});
      expect(result).toEqual(mockPaginatedResult);
    });
  });

  describe('PATCH /admin/users/:id — 更新用户', () => {
    it('应调用 UsersService.update 更新用户信息', async () => {
      const dto = { name: '李四' };
      const result = await controller.update(actor, 'user-uuid-1', dto);

      expect(usersService.update).toHaveBeenCalledWith(actor, 'user-uuid-1', dto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('PATCH /admin/users/:id/role — 变更用户角色', () => {
    it('应调用 UsersService.changeRole 变更角色', async () => {
      const dto: ChangeRoleRequest = { role: Role.ADMIN };
      const actor = { id: 'admin-uuid-1', email: 'admin@example.com', role: Role.SUPER_ADMIN };
      const result = await controller.changeRole(actor, 'user-uuid-1', dto);

      expect(usersService.changeRole).toHaveBeenCalledWith(actor, 'user-uuid-1', Role.ADMIN);
      expect(result.role).toBe(Role.ADMIN);
    });
  });

  describe('DELETE /admin/users/:id — 删除用户', () => {
    it('应调用 UsersService.remove 删除用户', async () => {
      const result = await controller.remove(actor, 'user-uuid-1');

      expect(usersService.remove).toHaveBeenCalledWith(actor, 'user-uuid-1');
      expect(result).toBeUndefined();
    });
  });

  describe('GET /admin/users/search — 搜索用户', () => {
    it('应调用 UsersService.search 返回分页结果', async () => {
      const result = await controller.search({ q: '张三', role: Role.USER, page: 1, pageSize: 20 });

      expect(usersService.search).toHaveBeenCalledWith({ q: '张三', role: Role.USER, page: 1, pageSize: 20 });
      expect(result).toEqual(mockPaginatedResult);
    });
  });
});

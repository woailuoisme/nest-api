/**
 * AdminUsersController 单元测试
 *
 * 覆盖：创建用户/列表/更新/变更角色/删除（管理端点，挂载于 /admin/users）
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersController } from '@/api/admin/users/users.controller';
import {
  type ChangeRoleRequest,
  type CreateUserRequest,
  type FindUsersRequest,
  UserEntity,
} from '@/api/admin/users/users.dto';
import { UsersService } from '@/api/admin/users/users.service';
import { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let usersService: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    changeRole: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  const mockUser = new UserEntity({
    id: 1,
    name: '张三',
    email: 'zhangsan@example.com',
    role: Role.USER,
    avatarUrl: null,
    emailVerifiedAt: null,
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
      remove: vi.fn().mockResolvedValue({ message: 'Usuário removido com sucesso' }),
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

      const result = await controller.create(dto);

      expect(usersService.create).toHaveBeenCalledWith(dto);
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
      const result = await controller.update(1, dto);

      expect(usersService.update).toHaveBeenCalledWith(1, dto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('PATCH /admin/users/:id/role — 变更用户角色', () => {
    it('应调用 UsersService.changeRole 变更角色', async () => {
      const dto: ChangeRoleRequest = { role: Role.ADMIN };
      const result = await controller.changeRole(1, dto);

      expect(usersService.changeRole).toHaveBeenCalledWith(1, Role.ADMIN);
      expect(result.role).toBe(Role.ADMIN);
    });
  });

  describe('DELETE /admin/users/:id — 删除用户', () => {
    it('应调用 UsersService.remove 删除用户', async () => {
      const result = await controller.remove(1);

      expect(usersService.remove).toHaveBeenCalledWith(1);
      expect(result).toEqual({ message: 'Usuário removido com sucesso' });
    });
  });
});

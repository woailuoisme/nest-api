import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminsController } from '@/api/admin/admins/admins.controller';
import type { AdminItemResponse, CreateAdminRequest, UpdateAdminRequest } from '@/api/admin/admins/admins.dto';
import { AdminsService } from '@/api/admin/admins/admins.service';
import { AdminRole, AdminStatus } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';

describe('AdminsController', () => {
  let controller: AdminsController;
  let adminsService: {
    findAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const mockAdmin: AdminItemResponse = {
    id: 1,
    name: 'Super Admin',
    email: 'admin@example.com',
    role: AdminRole.SUPER_ADMIN,
    status: AdminStatus.ACTIVE,
    avatarUrl: null,
    lastLoginAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockPaginatedResult = new PaginatedResultResource(
    [mockAdmin],
    new PageMetaResource({ page: 1, pageSize: 20 }, 1),
  );

  beforeEach(async () => {
    adminsService = {
      findAll: vi.fn().mockResolvedValue(mockPaginatedResult),
      create: vi.fn().mockResolvedValue(mockAdmin),
      findById: vi.fn().mockResolvedValue(mockAdmin),
      update: vi.fn().mockResolvedValue(mockAdmin),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminsController],
      providers: [{ provide: AdminsService, useValue: adminsService }],
    }).compile();

    controller = module.get(AdminsController);
  });

  it('findAll 应调用 adminsService.findAll 返回分页数据', async () => {
    const query = { page: 1, pageSize: 20 };
    const result = await controller.findAll(query as any);

    expect(adminsService.findAll).toHaveBeenCalledWith(query);
    expect(result).toEqual(mockPaginatedResult);
  });

  it('create 应调用 adminsService.create 创建管理员', async () => {
    const dto: CreateAdminRequest = {
      name: 'New Admin',
      email: 'new@example.com',
      password: 'password123',
      role: AdminRole.ADMIN,
      status: AdminStatus.ACTIVE,
    };

    const result = await controller.create(dto);
    expect(adminsService.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(mockAdmin);
  });

  it('findById 应调用 adminsService.findById 获取详情', async () => {
    const result = await controller.findById(1);
    expect(adminsService.findById).toHaveBeenCalledWith(1);
    expect(result).toEqual(mockAdmin);
  });

  it('update 应调用 adminsService.update 更新管理员', async () => {
    const dto: UpdateAdminRequest = { name: 'Updated Name' };
    const result = await controller.update(1, dto);
    expect(adminsService.update).toHaveBeenCalledWith(1, dto);
    expect(result).toEqual(mockAdmin);
  });

  it('delete 应调用 adminsService.delete 并透传当前管理员 ID 避免自删', async () => {
    await controller.delete(2, 1);
    expect(adminsService.delete).toHaveBeenCalledWith(2, 1);
  });
});

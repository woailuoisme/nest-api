/**
 * UsersController 单元测试（前端自助端点）
 *
 * 覆盖：当前用户/用户详情/头像上传。管理端点见 tests/unit/admin/users/users.controller.test.ts
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersController } from '@/api/client/users/users.controller';
import { UserEntity } from '@/api/client/users/users.dto';
import { UsersService } from '@/api/client/users/users.service';
import { Role } from '@/common/constants/roles';

describe('UsersController', () => {
  let usersController: UsersController;
  let usersService: {
    findOne: ReturnType<typeof vi.fn>;
    updateAvatar: ReturnType<typeof vi.fn>;
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

  beforeEach(async () => {
    usersService = {
      findOne: vi.fn().mockResolvedValue(mockUser),
      updateAvatar: vi.fn().mockResolvedValue({ ...mockUser, avatarUrl: '/uploads/avatars/avatar.png' }),
    };

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    usersController = module.get(UsersController);
  });

  describe('GET /users/me — 当前用户', () => {
    it('应调用 UsersService.findOne 获取当前用户信息', async () => {
      const currentUser = { id: 1 };
      const result = await usersController.findMe(currentUser);

      expect(usersService.findOne).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockUser);
    });
  });

  describe('GET /users/:id — 用户详情', () => {
    it('应调用 UsersService.findOne 获取指定用户', async () => {
      const result = await usersController.findOne(1);

      expect(usersService.findOne).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockUser);
    });

    it('应正确传递不同 ID', async () => {
      await usersController.findOne(999);

      expect(usersService.findOne).toHaveBeenCalledWith(999);
    });
  });

  describe('POST /users/me/avatar — 上传头像', () => {
    it('应传递 UploadedFile 调用 UsersService.updateAvatar', async () => {
      const file = {
        type: 'memory' as const,
        fieldname: 'file',
        filename: 'avatar.png',
        mimetype: 'image/png',
        buffer: Buffer.from('png-data'),
        size: 8,
      };

      const result = await usersController.uploadAvatar({ id: 1 }, file);

      expect(usersService.updateAvatar).toHaveBeenCalledWith(1, file);
      expect(result.avatarUrl).toBe('/uploads/avatars/avatar.png');
    });

    it('未接收到文件时应抛 BadRequestException', async () => {
      await expect(usersController.uploadAvatar({ id: 1 }, undefined as never)).rejects.toThrow('未接收到文件');
    });
  });
});

/**
 * UsersController 单元测试（前端自助端点）
 *
 * 覆盖：当前用户/用户详情/头像上传。管理端点见 tests/unit/admin/users/users.controller.test.ts
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import { UsersController } from '@/features/client/users/users.controller';
import { UserEntity } from '@/features/client/users/users.dto';
import { UsersService } from '@/features/client/users/users.service';

describe('UsersController', () => {
  let usersController: UsersController;
  let usersService: {
    findOne: ReturnType<typeof vi.fn>;
    updateAvatar: ReturnType<typeof vi.fn>;
  };

  const mockUser = new UserEntity({
    id: 'user-uuid-1',
    name: '张三',
    email: 'zhangsan@example.com',
    role: Role.USER,
    avatarUrl: null,
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
      const currentUser = { id: 'user-uuid-1' };
      const result = await usersController.findMe(currentUser as any);

      expect(usersService.findOne).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUser);
    });
  });

  describe('GET /users/:id — 用户详情', () => {
    // 归属校验已由 @Can(UserPolicy, 'view') 在守卫阶段完成
    it('应调用 UsersService.findOne', async () => {
      const result = await usersController.findOne('user-uuid-1');

      expect(usersService.findOne).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUser);
    });
  });

  describe('POST /users/me/avatar — 上传头像', () => {
    it('应传递 UploadedFile 调用 UsersService.updateAvatar', async () => {
      const file = {
        fieldname: 'file',
        originalname: 'avatar.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.from('png-data'),
        size: 8,
      };

      const result = await usersController.uploadAvatar({ id: 'user-uuid-1' } as any, file);

      expect(usersService.updateAvatar).toHaveBeenCalledWith('user-uuid-1', file);
      expect(result.avatarUrl).toBe('/uploads/avatars/avatar.png');
    });

    it('未接收到文件时应抛 BadRequestException', async () => {
      await expect(usersController.uploadAvatar({ id: 'user-uuid-1' } as any, undefined as never)).rejects.toThrow(
        '未接收到文件',
      );
    });

    it('应配置细粒度 @Throttle 限流元数据以防御高开销文件上传攻击', () => {
      const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', UsersController.prototype.uploadAvatar);
      const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', UsersController.prototype.uploadAvatar);
      expect(limit).toBe(10);
      expect(ttl).toBe(60000);
    });
  });
});

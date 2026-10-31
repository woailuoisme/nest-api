/**
 * 前端 UsersService 单元测试（自助面）
 *
 * 覆盖：用户详情查询（命中/404）、头像更新（预检/落库/事务补偿链路）。
 * 管理面测试见 tests/unit/admin/users/users.service.test.ts
 */
import { NotFoundException } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaService } from '@/common/media/media.service';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import { UserEntity } from '@/features/client/users/users.dto';
import { UsersService } from '@/features/client/users/users.service';

describe('UsersService (前端自助面)', () => {
  let usersService: UsersService;
  let db: ReturnType<typeof createMockDrizzleDb>;
  let mediaService: {
    save: ReturnType<typeof vi.fn>;
    deleteStored: ReturnType<typeof vi.fn>;
    url: ReturnType<typeof vi.fn>;
    storeWithCompensation: ReturnType<typeof vi.fn>;
  };

  const mockUser = {
    id: 'user-uuid-1',
    name: '张三',
    email: 'zhangsan@example.com',
    role: 'USER',
    avatarPath: null,
    emailVerified: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    db = createMockDrizzleDb();

    const saveMock = vi.fn().mockResolvedValue({
      path: 'avatars/20260813/abc.png',
      url: '/uploads/avatars/20260813/abc.png',
      isNew: true,
    });
    const deleteStoredMock = vi.fn().mockResolvedValue(undefined);
    const urlMock = vi.fn().mockImplementation((path: string) => ({
      preset: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue(`http://localhost:8080/sig/${path}`),
      }),
    }));
    const storeWithCompensationMock = vi.fn().mockImplementation(async (file, opts, callback, cleanup) => {
      const saved = await saveMock(file, opts);
      let res: unknown;
      try {
        res = await callback(saved);
      } catch (err) {
        await deleteStoredMock(saved.path).catch(() => undefined);
        throw err;
      }
      if (cleanup?.oldPath) {
        await deleteStoredMock(cleanup.oldPath).catch(() => undefined);
      }
      return res;
    });

    mediaService = {
      save: saveMock,
      deleteStored: deleteStoredMock,
      url: urlMock,
      storeWithCompensation: storeWithCompensationMock,
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getDrizzleToken(), useValue: db },
        { provide: MediaService, useValue: mediaService },
      ],
    }).compile();

    usersService = module.get(UsersService);
  });

  describe('findOne() — 查询用户详情', () => {
    it('应返回 UserEntity 且序列化后安全剥离 passwordHash', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await usersService.findOne('user-uuid-1');

      expect(result).toBeInstanceOf(UserEntity);
      expect(result.id).toBe('user-uuid-1');
      expect(result).toHaveProperty('name', '张三');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.avatarUrl).toBeNull();
      expect(result.avatarPath).toBeNull();
    });

    it('存在头像时应使用 imgproxy 生成 avatarUrl', async () => {
      db._stubs.findFirstUser.mockResolvedValue({
        ...mockUser,
        avatarPath: 'avatars/20260813/abc.png',
      });

      const result = await usersService.findOne('user-uuid-1');

      expect(result.avatarPath).toBe('avatars/20260813/abc.png');
      expect(result.avatarUrl).toBe('http://localhost:8080/sig/avatars/20260813/abc.png');
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.findOne('non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateAvatar() — 更新头像', () => {
    const avatarFile: UploadedFile = {
      fieldname: 'file',
      originalname: 'avatar.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: Buffer.from('png-data'),
      size: 8,
    };
    const userWithOldAvatar = { ...mockUser, avatarPath: 'avatars/old.png' };

    it('应先预检用户，再存盘更新 avatarPath 并返回带 imgproxy URL 的实体', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, avatarPath: 'avatars/20260813/abc.png' }]);

      const result = await usersService.updateAvatar('user-uuid-1', avatarFile);

      expect(db._stubs.findFirstUser).toHaveBeenCalled();
      expect(mediaService.save).toHaveBeenCalledWith(avatarFile, {
        prefix: 'avatars',
      });
      expect(result.avatarPath).toBe('avatars/20260813/abc.png');
      expect(result.avatarUrl).toBe('http://localhost:8080/sig/avatars/20260813/abc.png');
    });

    it('预检用户不存在时应抛 NotFoundException，不触盘', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.updateAvatar('non-existent', avatarFile)).rejects.toBeInstanceOf(NotFoundException);
      expect(mediaService.save).not.toHaveBeenCalled();
    });

    it('DB 更新失败时应回滚已写入的新文件', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);
      db._stubs.updateReturning.mockResolvedValue([]);

      await expect(usersService.updateAvatar('user-uuid-1', avatarFile)).rejects.toBeInstanceOf(NotFoundException);
      expect(mediaService.deleteStored).toHaveBeenCalledWith('avatars/20260813/abc.png');
    });

    it('更新成功后应使用相对路径删除旧头像', async () => {
      db._stubs.findFirstUser.mockResolvedValue(userWithOldAvatar);
      db._stubs.updateReturning.mockResolvedValue([{ ...userWithOldAvatar, avatarPath: 'avatars/20260813/abc.png' }]);

      await usersService.updateAvatar('user-uuid-1', avatarFile);

      expect(mediaService.deleteStored).toHaveBeenCalledWith('avatars/old.png');
    });

    it('无旧头像时不触发删除', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, avatarPath: 'avatars/20260813/abc.png' }]);

      await usersService.updateAvatar('user-uuid-1', avatarFile);

      expect(mediaService.deleteStored).not.toHaveBeenCalledWith('avatars/old.png');
    });
  });
});

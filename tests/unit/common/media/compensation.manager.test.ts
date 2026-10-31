import type { StorageDisk } from '@nestjs/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaCompensationManager } from '@/common/media/managers/compensation.manager';
import type { StorageService } from '@/common/storage/storage.service';

describe('MediaCompensationManager', () => {
  let manager: MediaCompensationManager;

  const storageMock = {
    disk: vi.fn().mockReturnThis(),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MediaCompensationManager();
  });

  describe('executeWithCompensation()', () => {
    it('当业务回调成功时执行并触发旧相对路径文件清理', async () => {
      const mockResult = {
        path: 'avatars/new.png',
        url: '/uploads/avatars/new.png',
        isNew: true,
      };

      const saveOperation = vi.fn().mockResolvedValue(mockResult);
      const onStored = vi.fn().mockResolvedValue({ id: 1, avatarPath: mockResult.path });

      const data = await manager.executeWithCompensation(
        storageMock as unknown as StorageService,
        undefined,
        saveOperation,
        onStored,
        { oldPath: 'avatars/old.png' },
      );

      expect(data).toEqual({ id: 1, avatarPath: mockResult.path });
      expect(onStored).toHaveBeenCalledWith(mockResult);
      expect(storageMock.delete).toHaveBeenCalledWith('avatars/old.png');
    });

    it('当业务回调异常时直接回滚删除新建的物理文件', async () => {
      const mockResult = {
        path: 'avatars/new.png',
        url: '/uploads/avatars/new.png',
        isNew: true,
      };

      const saveOperation = vi.fn().mockResolvedValue(mockResult);
      const onStored = vi.fn().mockRejectedValue(new Error('Database error'));

      await expect(
        manager.executeWithCompensation(storageMock as unknown as StorageService, undefined, saveOperation, onStored, {
          oldPath: 'avatars/old.png',
        }),
      ).rejects.toThrow('Database error');

      expect(storageMock.delete).toHaveBeenCalledWith(['avatars/new.png']);
      expect(storageMock.delete).not.toHaveBeenCalledWith('avatars/old.png');
    });

    it('当 isNew 为 false 时不执行回滚删除（避免误删去重文件）', async () => {
      const mockResult = {
        path: 'avatars/existing.png',
        url: '/uploads/avatars/existing.png',
        isNew: false,
      };

      const saveOperation = vi.fn().mockResolvedValue(mockResult);
      const onStored = vi.fn().mockRejectedValue(new Error('Database error'));

      await expect(
        manager.executeWithCompensation(storageMock as unknown as StorageService, undefined, saveOperation, onStored, {
          oldPath: 'avatars/old.png',
        }),
      ).rejects.toThrow('Database error');

      expect(storageMock.delete).not.toHaveBeenCalled();
    });
  });

  describe('deletePaths()', () => {
    it('优先调用 disk.delete 批量删除', async () => {
      const disk = {
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as StorageDisk;

      await manager.deletePaths(disk, ['a.png', 'b.png']);
      expect(disk.delete).toHaveBeenCalledWith(['a.png', 'b.png']);
    });

    it('空数组时不调用 disk.delete', async () => {
      const disk = {
        delete: vi.fn(),
      } as unknown as StorageDisk;

      await manager.deletePaths(disk, []);
      expect(disk.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupOldPaths()', () => {
    it('当存在多个旧文件时并发调用 disk.delete 执行清理', async () => {
      const disk = {
        delete: vi.fn().mockResolvedValue(undefined),
      } as unknown as StorageDisk;

      await manager.cleanupOldPaths(disk, { oldPath: 'a.png', oldPaths: ['b.png'] });
      expect(disk.delete).toHaveBeenCalledWith('a.png');
      expect(disk.delete).toHaveBeenCalledWith('b.png');
    });

    it('单个清理失败时捕获异常并继续清理其他文件', async () => {
      const disk = {
        delete: vi.fn().mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(undefined),
      } as unknown as StorageDisk;

      await expect(
        manager.cleanupOldPaths(disk, { oldPath: 'fail.png', oldPaths: ['ok.png'] }),
      ).resolves.toBeUndefined();
      expect(disk.delete).toHaveBeenCalledWith('fail.png');
      expect(disk.delete).toHaveBeenCalledWith('ok.png');
    });

    it('无待清理文件时不调用 disk.delete', async () => {
      const disk = {
        delete: vi.fn(),
      } as unknown as StorageDisk;

      await manager.cleanupOldPaths(disk);
      expect(disk.delete).not.toHaveBeenCalled();
    });
  });

  describe('extractOldPaths()', () => {
    it('提取单个 oldPath', () => {
      expect(manager.extractOldPaths({ oldPath: 'test.png' })).toEqual(['test.png']);
    });

    it('合并并过滤 oldPath 与 oldPaths 中的空值', () => {
      expect(
        manager.extractOldPaths({
          oldPath: 'a.png',
          oldPaths: ['b.png', null, undefined, 'c.png'],
        }),
      ).toEqual(['a.png', 'b.png', 'c.png']);
    });

    it('无参数时返回空数组', () => {
      expect(manager.extractOldPaths()).toEqual([]);
    });
  });
});

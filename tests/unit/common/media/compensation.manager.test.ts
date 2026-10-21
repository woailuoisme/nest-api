import type { StorageDisk } from '@nestjs/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaCompensationManager } from '@/common/media/managers/compensation.manager';
import type { StorageService } from '@/common/storage/storage.service';
import type { MediaJobs } from '@/jobs/media/media.jobs';

describe('MediaCompensationManager', () => {
  let manager: MediaCompensationManager;

  const storageMock = {
    disk: vi.fn().mockReturnThis(),
    getUrl: vi.fn((p: string) => `/uploads/${p}`),
    urlToPath: vi.fn((url: string) => (url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null)),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteBatch: vi.fn().mockResolvedValue(undefined),
  };

  const mediaJobsMock = {
    removeJob: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MediaCompensationManager();
  });

  describe('executeWithCompensation()', () => {
    it('当业务回调成功时执行并触发旧文件清理', async () => {
      const mockResult = {
        path: 'avatars/new.png',
        url: '/uploads/avatars/new.png',
        isNew: true,
      };

      const saveOperation = vi.fn().mockResolvedValue(mockResult);
      const onStored = vi.fn().mockResolvedValue({ id: 1, avatarUrl: mockResult.url });

      const data = await manager.executeWithCompensation(
        storageMock as unknown as StorageService,
        undefined,
        saveOperation,
        onStored,
        { oldUrl: '/uploads/avatars/old.png' },
        mediaJobsMock as unknown as MediaJobs,
      );

      expect(data).toEqual({ id: 1, avatarUrl: mockResult.url });
      expect(onStored).toHaveBeenCalledWith(mockResult);
    });

    it('当业务回调异常时回滚新写文件并撤销已派发的 BullMQ 任务', async () => {
      const mockResult = {
        path: 'avatars/new.png',
        url: '/uploads/avatars/new.png',
        isNew: true,
        variants: {
          pendingThumb: {
            path: 'avatars/new-thumb-pending.webp',
            url: '/uploads/avatars/new-thumb-pending.webp',
            isNew: true,
            status: 'pending' as const,
            jobId: 'job-123',
          },
          readyThumb: {
            path: 'avatars/new-thumb-ready.webp',
            url: '/uploads/avatars/new-thumb-ready.webp',
            isNew: true,
            status: 'ready' as const,
          },
        },
      };

      const saveOperation = vi.fn().mockResolvedValue(mockResult);
      const onStored = vi.fn().mockRejectedValue(new Error('Database error'));

      await expect(
        manager.executeWithCompensation(
          storageMock as unknown as StorageService,
          undefined,
          saveOperation,
          onStored,
          { oldUrl: '/uploads/avatars/old.png' },
          mediaJobsMock as unknown as MediaJobs,
        ),
      ).rejects.toThrow('Database error');

      expect(mediaJobsMock.removeJob).toHaveBeenCalledWith('job-123');
      expect(storageMock.delete).toHaveBeenCalledWith(['avatars/new.png', 'avatars/new-thumb-ready.webp']);
      expect(storageMock.delete).not.toHaveBeenCalledWith('avatars/old.png');
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

    it('当批量 delete 失败时降级逐个删除', async () => {
      const deleteMock = vi.fn().mockRejectedValueOnce(new Error('Batch delete failed')).mockResolvedValue(undefined);
      const disk = {
        delete: deleteMock,
      } as unknown as StorageDisk;

      await manager.deletePaths(disk, ['a.png', 'b.png']);
      expect(deleteMock).toHaveBeenCalledWith(['a.png', 'b.png']);
      expect(deleteMock).toHaveBeenCalledWith('a.png');
      expect(deleteMock).toHaveBeenCalledWith('b.png');
    });
  });

  describe('extractOldUrls()', () => {
    it('应正确聚合 oldUrl 与 oldUrls 数组', () => {
      const urls = manager.extractOldUrls({
        oldUrl: '/a.png',
        oldUrls: ['/b.png', '/c.png'],
      });
      expect(urls).toEqual(['/a.png', '/b.png', '/c.png']);
    });

    it('无 cleanup 选项时返回空数组', () => {
      expect(manager.extractOldUrls(undefined)).toEqual([]);
    });
  });
});

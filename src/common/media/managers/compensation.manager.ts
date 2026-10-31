import { Injectable, Logger } from '@nestjs/common';
import type { StorageDisk } from '@nestjs/storage';
import { compact } from 'es-toolkit';

import type { StorageService } from '@/common/storage/storage.service';

import type { MediaCleanupOptions, MediaUploadResult } from '../interfaces/media.interface';

/**
 * 媒体存储事务补偿管理器 (MediaCompensationManager)
 *
 * 专注于两阶段事务补偿屏障（纯相对路径，无脆弱 URL 反解）：
 * 1. 物理写入主文件；
 * 2. 执行领域持久化回调；
 * 3. 失败时自动回滚删除新建物理文件；
 * 4. 成功时自动幂等回收旧媒体文件（直接基于 relative path，支持 Local 与 S3）。
 */
@Injectable()
export class MediaCompensationManager {
  private readonly logger = new Logger(MediaCompensationManager.name);

  /**
   * 执行带事务补偿的安全存储流程
   */
  async executeWithCompensation<T>(
    storage: StorageService,
    diskName: string | undefined,
    saveOperation: () => Promise<MediaUploadResult>,
    onStored: (result: MediaUploadResult) => Promise<T>,
    cleanup?: MediaCleanupOptions,
  ): Promise<T> {
    const result = await saveOperation();
    const disk = storage.disk(diskName);
    let data: T;

    try {
      data = await onStored(result);
    } catch (error) {
      // 业务执行异常 → 仅回滚本次操作新创建的物理文件（不误删已有 deduplicated 共享物理文件）
      if (result.isNew !== false) {
        await this.deletePaths(disk, [result.path]);
      }
      throw error;
    }

    // 业务执行成功 → 清理旧相对路径文件
    await this.cleanupOldPaths(disk, cleanup);

    return data;
  }

  /**
   * 批量删除已创建的物理文件列表
   */
  async deletePaths(disk: StorageDisk, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      await disk.delete(paths);
      return;
    } catch {
      // 若批量删除异常则降级为逐个删除
      await Promise.all(
        paths.map((p) =>
          disk.delete(p).catch((err: unknown) => {
            this.logger.warn(`回滚删除媒体文件失败: ${String(err)}`);
          }),
        ),
      );
    }
  }

  /**
   * 清理旧文件（直接基于相对存储路径，安全且高效）
   */
  async cleanupOldPaths(disk: StorageDisk, cleanup?: MediaCleanupOptions): Promise<void> {
    const oldPaths = this.extractOldPaths(cleanup);
    if (oldPaths.length === 0) return;

    await Promise.all(
      oldPaths.map((path) =>
        disk.delete(path).catch((err: unknown) => {
          this.logger.warn(`清理旧文件失败 [${path}]: ${String(err)}`);
        }),
      ),
    );
  }

  /** 提取并扁平化旧文件相对路径清单 */
  extractOldPaths(cleanup?: MediaCleanupOptions): string[] {
    if (!cleanup) return [];
    return compact([cleanup.oldPath, ...(cleanup.oldPaths ?? [])]);
  }
}

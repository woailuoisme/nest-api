import { Injectable, Logger } from '@nestjs/common';
import { compact } from 'es-toolkit';
import type { StorageDriver } from '@/common/storage/interfaces/storage.interface';
import type { StorageService } from '@/common/storage/storage.service';
import type { MediaJobs } from '@/jobs/media/media.jobs';
import type { MediaCleanupOptions, MediaUploadResult } from '../interfaces/media.interface';

/**
 * 媒体存储事务补偿与生命周期管理器 (MediaCompensationManager)
 *
 * 专注于两阶段事务补偿屏障：
 * 1. 物理写入主文件与缩略图；
 * 2. 执行领域持久化回调；
 * 3. 失败时自动撤销 BullMQ 任务并回滚删除新建物理文件；
 * 4. 成功时自动幂等回收旧媒体文件（支持 Local 与 S3 反解）。
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
    mediaJobs?: MediaJobs,
  ): Promise<T> {
    const result = await saveOperation();
    const disk = storage.disk(diskName);
    let data: T;

    try {
      data = await onStored(result);
    } catch (error) {
      // 业务执行异常 → 若投递了异步任务，优先从 BullMQ 队列撤销该任务
      await this.cancelVariantJobs(result, mediaJobs);

      // 仅回滚本次操作新创建的物理主文件和已就绪变体
      const pathsToDelete = this.collectRollbackPaths(result);
      if (pathsToDelete.length > 0) {
        await this.deletePaths(disk, pathsToDelete);
      }
      throw error;
    }

    // 业务执行成功 → 清理旧文件
    await this.cleanupOldUrls(storage, disk, cleanup, diskName);

    return data;
  }

  /**
   * 批量删除已创建的物理文件列表
   */
  async deletePaths(disk: StorageDriver, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    if (typeof disk.deleteBatch === 'function') {
      try {
        await disk.deleteBatch(paths);
        return;
      } catch {
        // 若 deleteBatch 异常则降级为逐个删除
      }
    }
    await Promise.all(
      paths.map((p) =>
        disk.delete(p).catch((err: unknown) => {
          this.logger.warn(`回滚删除媒体文件失败: ${String(err)}`);
        }),
      ),
    );
  }

  /**
   * 取消/撤销媒体结果中已向 BullMQ 投递的异步任务（用于补偿回滚）
   */
  async cancelVariantJobs(results: MediaUploadResult | MediaUploadResult[], mediaJobs?: MediaJobs): Promise<void> {
    if (!mediaJobs) return;
    const list = Array.isArray(results) ? results : [results];
    const jobIds = list.flatMap((item) =>
      item.variants ? compact(Object.values(item.variants).map((v) => v.jobId)) : [],
    );
    if (jobIds.length > 0) {
      await Promise.all(jobIds.map((id) => mediaJobs.removeJob(id).catch(() => false)));
    }
  }

  /**
   * 清理旧媒体文件
   */
  async cleanupOldUrls(
    storage: StorageService,
    disk: StorageDriver,
    cleanup?: MediaCleanupOptions,
    diskName?: string,
  ): Promise<void> {
    const oldUrls = this.extractOldUrls(cleanup);
    if (oldUrls.length === 0) return;

    for (const url of oldUrls) {
      const path = storage.urlToPath(url, diskName);
      if (path) {
        await disk.delete(path).catch((err: unknown) => {
          this.logger.warn(`清理旧媒体文件失败: ${String(err)}`);
        });
      }
    }
  }

  /** 收集需回滚的物理路径：仅本次新建的主图与已就绪变体（避免误删去重共享的已存在文件） */
  private collectRollbackPaths(result: MediaUploadResult): string[] {
    const variantPaths = result.variants
      ? Object.values(result.variants)
          .filter((v) => v.isNew !== false && v.status === 'ready')
          .map((v) => v.path)
      : [];

    return compact([result.isNew !== false ? result.path : null, ...variantPaths]);
  }

  /** 提取并扁平化旧文件 URL 清单 */
  extractOldUrls(cleanup?: MediaCleanupOptions): string[] {
    if (!cleanup) return [];
    return compact([cleanup.oldUrl, ...(cleanup.oldUrls ?? [])]);
  }
}

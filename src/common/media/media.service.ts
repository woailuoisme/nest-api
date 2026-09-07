import { createReadStream, promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { BadRequestException, Injectable, Logger, Optional, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmptyObject } from 'es-toolkit';
import type { OutputInfo } from 'sharp';
import type { StorageDriver } from '@/common/storage/interfaces/storage.interface';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import { StorageService } from '@/common/storage/storage.service';
import { MediaJobs } from '@/queues/media/media.jobs';
import type {
  ImageMetadata,
  ImageResizeOptions,
  MediaCleanupOptions,
  MediaSaveOptions,
  MediaUploadResult,
  MediaVariantResult,
  QrCodeOptions,
  QrCodeSaveOptions,
  UploadResult,
} from './interfaces/media.interface';
import { MediaCompensationManager } from './managers/compensation.manager';
import { ImageProcessor } from './processors/image.processor';
import { QrCodeProcessor } from './processors/qrcode.processor';
import { buildMediaPath, buildVariantPath } from './strategies/naming.strategy';

/**
 * 统一通用媒体处理与存储门面 (MediaService Facade)
 *
 * 在底层基础设施之上提供聚合门面：
 * 1. 存储与多格式自适应（流式与内存、本地与 S3）；
 * 2. 图像 Sharp 转码与多规格衍生（委托 ImageProcessor）；
 * 3. 事务性自动补偿与防孤儿屏障（委托 MediaCompensationManager）；
 * 4. 二维码生成、SVG 渲染与图层合成（委托 QrCodeProcessor）；
 * 5. BullMQ 异步队列变体分发（可选注入 MediaJobs）。
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly img: ImageProcessor;
  private readonly qr: QrCodeProcessor;
  private readonly comp: MediaCompensationManager;

  constructor(
    private readonly storage: StorageService,
    @Optional() imageProcessor?: ImageProcessor,
    @Optional() qrCodeProcessor?: QrCodeProcessor,
    @Optional() compensationManager?: MediaCompensationManager,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly mediaJobs?: MediaJobs,
  ) {
    this.img = imageProcessor ?? new ImageProcessor();
    this.qr = qrCodeProcessor ?? new QrCodeProcessor(storage);
    this.comp = compensationManager ?? new MediaCompensationManager();
  }

  /**
   * 存储单个上传文件，自适应流式与内存模式，自动执行图像优化、WebP 转换与多规格缩略图生成。
   */
  async save(file: UploadedFile, opts?: MediaSaveOptions): Promise<MediaUploadResult> {
    const disk = this.storage.disk(opts?.disk);
    const isImg = this.img.isImage(file.mimetype, file.filename);
    const newlyCreatedPaths: string[] = [];

    // 1. 严格流式防御：优先检测全局 limits 截断，避免将超大文件读入内存导致 OOM
    if (file.type === 'stream' && file.truncated) {
      await fs.unlink(file.tmpPath).catch(() => undefined);
      throw new PayloadTooLargeException(`文件 ${file.filename} 超出大小上限`);
    }

    try {
      // 2. 非图片文件（或 SVG 矢量）：保持 O(1) 流式直传存盘，不走 Sharp 像素管道
      if (!isImg || extname(file.filename).toLowerCase() === '.svg') {
        return await this.saveNonImage(file, opts, disk, newlyCreatedPaths);
      }

      // 3. 图片文件：提取 Buffer 并执行图像转换流水线
      const rawBuffer = await this.getFileBuffer(file);
      let metadata: ImageMetadata;
      try {
        metadata = await this.img.getImageMetadata(rawBuffer);
      } catch {
        if (opts?.convertToWebp || opts?.variants) {
          throw new BadRequestException(`图片文件损坏或格式不受支持: ${file.filename}`);
        }
        return await this.saveBufferDirect(rawBuffer, file, opts, disk, newlyCreatedPaths);
      }
      const { mainBuffer, contentType, overrideExt } = await this.prepareMainBuffer(rawBuffer, file.mimetype, opts);

      // 4. 生成主图存储路径并写入
      const mainPath = await buildMediaPath(file, opts, mainBuffer, overrideExt);
      const mainResult = await this.persistToDisk(disk, mainPath, mainBuffer, contentType, newlyCreatedPaths);

      // 5. 生成多规格缩略图/变体 (支持 BullMQ 异步队列与同步执行)
      const variants = await this.generateVariants(rawBuffer, mainPath, opts, disk, newlyCreatedPaths);

      return {
        path: mainPath,
        url: mainResult.url,
        isNew: mainResult.isNew,
        variants: !isEmptyObject(variants) ? variants : undefined,
        metadata: {
          ...metadata,
          size: mainBuffer.byteLength,
          format: overrideExt ? 'webp' : metadata.format,
        },
      };
    } catch (error) {
      // 失败安全回滚：仅删除本次操作新创建的物理文件（不误删已有 deduplicated 共享物理文件）
      if (newlyCreatedPaths.length > 0) {
        await this.comp.deletePaths(disk, newlyCreatedPaths);
      }
      throw error;
    } finally {
      // 消费即删：确保流式临时文件彻底清理
      if (file.type === 'stream') {
        await fs.unlink(file.tmpPath).catch(() => undefined);
      }
    }
  }

  /**
   * 批量存储多个上传文件。
   * 串行处理，任一文件或变体失败时自动回滚所有本次新写的文件，并取消已排队的 BullMQ 任务。
   */
  async saveBatch(files: UploadedFile[], opts?: MediaSaveOptions): Promise<MediaUploadResult[]> {
    const disk = this.storage.disk(opts?.disk);
    const savedResults: MediaUploadResult[] = [];
    const createdPaths: string[] = [];

    try {
      for (const file of files) {
        const res = await this.save(file, opts);
        savedResults.push(res);
        if (res.isNew !== false) {
          createdPaths.push(res.path);
        }
        if (res.variants) {
          for (const v of Object.values(res.variants)) {
            if (v.isNew !== false && v.status === 'ready') {
              createdPaths.push(v.path);
            }
          }
        }
      }
      return savedResults;
    } catch (err) {
      // 取消批量操作中已投递的 BullMQ 任务
      await this.comp.cancelVariantJobs(savedResults, this.mediaJobs);

      if (createdPaths.length > 0) {
        await this.comp.deletePaths(disk, createdPaths);
        this.logger.warn(`批量媒体上传失败，已回滚 ${createdPaths.length} 个已写文件/变体`);
      }
      throw err;
    }
  }

  /**
   * 事务性安全媒体存储 — 在业务写入与物理文件间建立自动补偿防孤儿屏障：
   * 委托 MediaCompensationManager 执行两阶段事务补偿。
   */
  async storeWithCompensation<T>(
    file: UploadedFile,
    opts: MediaSaveOptions | undefined,
    onStored: (result: MediaUploadResult) => Promise<T>,
    cleanup?: MediaCleanupOptions,
  ): Promise<T> {
    return this.comp.executeWithCompensation(
      this.storage,
      opts?.disk,
      () => this.save(file, opts),
      onStored,
      cleanup,
      this.mediaJobs,
    );
  }

  /** 按存储相对路径删除物理文件（幂等 — driver 内部捕获 ENOENT） */
  async deleteStored(path: string, diskName?: string): Promise<void> {
    const disk = this.storage.disk(diskName);
    await disk.delete(path);
  }

  /**
   * 按公开 URL 删除物理文件 — 支持 Local 与 S3 驱动双向 URL 反解。
   * 自动将 Local /uploads/... 或 S3 绝对 URL 转换为存储相对路径后幂等删除。
   */
  async deleteByUrl(url: string, diskName?: string): Promise<void> {
    if (!url) return;
    const path = this.storage.urlToPath(url, diskName);
    if (!path) return;
    const disk = this.storage.disk(diskName);
    await disk.delete(path);
  }

  // ── 独立图像处理工具方法（委托 ImageProcessor） ─────────────────────────

  /** 判断是否为图像 MIME 类型或扩展名 */
  isImage(mimetype?: string, filename?: string): boolean {
    return this.img.isImage(mimetype, filename);
  }

  /** 独立将图像转换为 WebP 格式 */
  async convertToWebp(
    input: Buffer | string,
    options?: { quality?: number },
  ): Promise<{ buffer: Buffer; info: OutputInfo }> {
    return this.img.convertToWebp(input, options);
  }

  /** 独立对图像进行自动校正与优化（无格式变更） */
  async optimize(input: Buffer | string): Promise<{ buffer: Buffer; info: OutputInfo }> {
    return this.img.optimize(input);
  }

  /** 图像变换工具方法 — 支持尺寸缩放、裁剪、质量控制与格式转换 */
  async transformImage(
    input: Buffer | string,
    options: ImageResizeOptions,
  ): Promise<{ buffer: Buffer; info: OutputInfo }> {
    return this.img.transformImage(input, options);
  }

  /** 提取图像元数据（分辨率、格式、透明度、宽高比等） */
  async getImageMetadata(input: Buffer | string): Promise<ImageMetadata> {
    return this.img.getImageMetadata(input);
  }

  // ── 二维码生成与存储门面（委托 QrCodeProcessor） ─────────────────────────

  /** 生成二维码 Buffer（支持 PNG / WebP / SVG，支持中心 Logo 合成） */
  async generateQrCodeBuffer(content: string, options?: QrCodeOptions): Promise<Buffer> {
    return this.qr.generateBuffer(content, options);
  }

  /** 生成 Base64 / SVG Data URL 形式的二维码（方便前端直接绑定到 <img src="...">） */
  async generateQrCodeDataUrl(content: string, options?: QrCodeOptions): Promise<string> {
    return this.qr.generateDataUrl(content, options);
  }

  /** 生成 SVG 矢量 XML 字符串二维码（支持中心 Logo 嵌入） */
  async generateQrCodeSvg(content: string, options?: QrCodeOptions): Promise<string> {
    return this.qr.generateSvg(content, options);
  }

  /** 生成二维码并直接上传持久化到存储驱动，返回存储路径与访问 URL */
  async generateAndStoreQrCode(
    content: string,
    options?: QrCodeOptions,
    saveOpts?: QrCodeSaveOptions,
  ): Promise<UploadResult> {
    return this.qr.generateAndStore(this.storage, content, options, saveOpts);
  }

  // ── 内部辅助流程 ─────────────────────────────────────────────────────────

  private async persistToDisk(
    disk: StorageDriver,
    path: string,
    content: Buffer | import('node:stream').Readable,
    contentType: string,
    newlyCreatedPaths: string[],
  ): Promise<MediaUploadResult> {
    const exists = await disk.exists(path).catch(() => false);
    await disk.put(path, content, { contentType });
    if (!exists) newlyCreatedPaths.push(path);
    return { path, url: disk.getUrl(path), isNew: !exists };
  }

  private async saveNonImage(
    file: UploadedFile,
    opts: MediaSaveOptions | undefined,
    disk: StorageDriver,
    newlyCreatedPaths: string[],
  ): Promise<MediaUploadResult> {
    const path = await buildMediaPath(file, opts);
    const content = file.type === 'stream' ? createReadStream(file.tmpPath) : file.buffer;
    return this.persistToDisk(disk, path, content, file.mimetype, newlyCreatedPaths);
  }

  private async saveBufferDirect(
    buffer: Buffer,
    file: UploadedFile,
    opts: MediaSaveOptions | undefined,
    disk: StorageDriver,
    newlyCreatedPaths: string[],
  ): Promise<MediaUploadResult> {
    const path = await buildMediaPath(file, opts, buffer);
    return this.persistToDisk(disk, path, buffer, file.mimetype, newlyCreatedPaths);
  }

  private async prepareMainBuffer(
    rawBuffer: Buffer,
    defaultMime: string,
    opts?: MediaSaveOptions,
  ): Promise<{ mainBuffer: Buffer; contentType: string; overrideExt?: string }> {
    if (opts?.convertToWebp) {
      const webpResult = await this.img.convertToWebp(rawBuffer, { quality: opts.webpQuality });
      return { mainBuffer: webpResult.buffer, contentType: 'image/webp', overrideExt: '.webp' };
    }
    if (opts?.optimize !== false) {
      const optResult = await this.img.optimize(rawBuffer);
      return { mainBuffer: optResult.buffer, contentType: defaultMime };
    }
    return { mainBuffer: rawBuffer, contentType: defaultMime };
  }

  private async generateVariants(
    rawBuffer: Buffer,
    mainPath: string,
    opts: MediaSaveOptions | undefined,
    disk: StorageDriver,
    newlyCreatedPaths: string[],
  ): Promise<Record<string, MediaVariantResult>> {
    const variantsConfig = opts?.variants;
    if (!variantsConfig || isEmptyObject(variantsConfig)) {
      return {};
    }

    const queueConfigEnabled = this.configService?.get<boolean>('MEDIA_QUEUE_ENABLED') ?? true;
    if (opts.asyncQueue === true && !this.mediaJobs) {
      this.logger.warn('MediaSaveOptions.asyncQueue 显式设置为 true，但 MediaJobs 生产者未注入，自动降级为同步执行');
    }

    const isAsyncQueue = (opts.asyncQueue ?? queueConfigEnabled) && !!this.mediaJobs;
    if (isAsyncQueue && this.mediaJobs) {
      return this.dispatchAsyncVariants(mainPath, variantsConfig, opts.disk, disk);
    }
    return this.renderSyncVariants(rawBuffer, mainPath, variantsConfig, disk, newlyCreatedPaths);
  }

  private async dispatchAsyncVariants(
    mainPath: string,
    variantsConfig: Record<string, ImageResizeOptions>,
    diskName: string | undefined,
    disk: StorageDriver,
  ): Promise<Record<string, MediaVariantResult>> {
    const variants: Record<string, MediaVariantResult> = {};
    const neededVariants: Record<string, ImageResizeOptions> = {};

    for (const [variantName, variantOpts] of Object.entries(variantsConfig)) {
      const variantFormat = variantOpts.format ?? 'webp';
      const variantPath = buildVariantPath(mainPath, variantName, variantFormat);
      const variantExists = await disk.exists(variantPath).catch(() => false);

      variants[variantName] = {
        path: variantPath,
        url: disk.getUrl(variantPath),
        isNew: !variantExists,
        status: variantExists ? 'ready' : 'pending',
      };

      if (!variantExists) {
        neededVariants[variantName] = variantOpts;
      }
    }

    if (!isEmptyObject(neededVariants) && this.mediaJobs) {
      const job = await this.mediaJobs.dispatchGenerateVariants({
        mainPath,
        variants: neededVariants,
        disk: diskName,
      });

      if (job?.id) {
        for (const [variantName, v] of Object.entries(variants)) {
          if (neededVariants[variantName]) {
            v.jobId = String(job.id);
          }
        }
      }
    }

    return variants;
  }

  private async renderSyncVariants(
    rawBuffer: Buffer,
    mainPath: string,
    variantsConfig: Record<string, ImageResizeOptions>,
    disk: StorageDriver,
    newlyCreatedPaths: string[],
  ): Promise<Record<string, MediaVariantResult>> {
    const variants: Record<string, MediaVariantResult> = {};

    for (const [variantName, variantOpts] of Object.entries(variantsConfig)) {
      const { buffer: variantBuffer } = await this.img.transformImage(rawBuffer, variantOpts);
      const variantFormat = variantOpts.format ?? 'webp';
      const variantPath = buildVariantPath(mainPath, variantName, variantFormat);
      const variantContentType = `image/${variantFormat}`;

      const variantExists = await disk.exists(variantPath).catch(() => false);
      await disk.put(variantPath, variantBuffer, { contentType: variantContentType });
      if (!variantExists) newlyCreatedPaths.push(variantPath);

      variants[variantName] = {
        path: variantPath,
        url: disk.getUrl(variantPath),
        isNew: !variantExists,
        status: 'ready',
      };
    }

    return variants;
  }

  private async getFileBuffer(file: UploadedFile): Promise<Buffer> {
    if (file.type === 'memory') {
      return file.buffer;
    }
    return fs.readFile(file.tmpPath);
  }
}

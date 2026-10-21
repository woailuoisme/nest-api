import { extname } from 'node:path';

import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageDisk } from '@nestjs/storage';
import { isEmptyObject } from 'es-toolkit';

import {
  getUploadContent,
  isMemoryUpload,
  isStreamUpload,
  type UploadedFile,
} from '@/common/storage/interfaces/upload.interface';
import { StorageService } from '@/common/storage/storage.service';
import { MediaJobs } from '@/jobs/media/media.jobs';

import { ImgproxyBuilder } from './imgproxy/imgproxy-builder';
import { ImgproxyService } from './imgproxy/imgproxy.service';
import type {
  ImageMetadata,
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
import { buildMediaPath } from './strategies/naming.strategy';

/**
 * 统一通用媒体处理与存储门面 (MediaService Facade)
 *
 * 在底层基础设施之上提供聚合门面：
 * 1. 存储与多格式自适应（流式与内存、本地与 S3）；
 * 2. imgproxy JIT 动态图像生成与签名安全构建器 (mediaService.url)；
 * 3. 图像快速元数据解析（委托纯 JS ImageProcessor）；
 * 4. 事务性自动补偿与防孤儿屏障（委托 MediaCompensationManager）；
 * 5. 二维码生成、SVG 渲染与矢量合成（委托 QrCodeProcessor）。
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly img: ImageProcessor;
  private readonly qr: QrCodeProcessor;
  private readonly comp: MediaCompensationManager;
  private readonly imgproxy: ImgproxyService;

  constructor(
    private readonly storage: StorageService,
    @Optional() imageProcessor?: ImageProcessor,
    @Optional() qrCodeProcessor?: QrCodeProcessor,
    @Optional() compensationManager?: MediaCompensationManager,
    @Optional() imgproxyService?: ImgproxyService,
    @Optional() configService?: ConfigService,
    @Optional() private readonly mediaJobs?: MediaJobs,
  ) {
    this.img = imageProcessor ?? new ImageProcessor();
    this.qr = qrCodeProcessor ?? new QrCodeProcessor(storage);
    this.comp = compensationManager ?? new MediaCompensationManager();
    this.imgproxy = imgproxyService ?? new ImgproxyService(configService ?? new ConfigService());
  }

  /**
   * 构造指定存储路径图片的 imgproxy JIT 动态处理 Fluent 构建器
   *
   * @param sourcePath 存储文件相对路径（如 avatars/20260820/uuid.png）
   * @example
   * ```ts
   * const avatarUrl = mediaService.url(path).preset('avatar').webp().build();
   * const thumbUrl = mediaService.url(path).resize({ width: 300, height: 300 }).webp().build();
   * ```
   */
  url(sourcePath: string): ImgproxyBuilder {
    return this.imgproxy.url(sourcePath);
  }

  /**
   * 存储单个上传文件，自适应流式与内存模式。
   * 保存原始主图（Master Asset），元数据同步解析。若指定了 variants，即时返回 imgproxy 签名 JIT URL。
   */
  async save(file: UploadedFile, opts?: MediaSaveOptions): Promise<MediaUploadResult> {
    const disk = this.storage.disk(opts?.disk);
    const isImg = this.img.isImage(file.mimetype, file.originalname);
    const newlyCreatedPaths: string[] = [];
    const isStream = !isMemoryUpload(file);

    // 流式载荷只能消费一次，而 hash 命名需要在命名阶段读取全量内容 → 明确拒绝，避免静默产出空文件
    if (isStream && opts?.naming === 'hash') {
      throw new BadRequestException('hash 命名需读取全量内容，流式上传请改用内存模式（FileInterceptor）');
    }

    try {
      // 1. 非图片文件（或 SVG 矢量）：保持 O(1) 流式直传存盘
      if (!isImg || extname(file.originalname).toLowerCase() === '.svg') {
        const path = await buildMediaPath(file, opts);
        const content = getUploadContent(file);
        try {
          return await this.persistToDisk(disk, path, content, file.mimetype, newlyCreatedPaths);
        } catch (error) {
          // 流式载荷边写边传，中途失败（如超出 limits.fileSize 的 413）可能已留下部分写入的目标文件 → 幂等清理。
          // 仅流式载荷需要：内存载荷在传入前已完整持有内容，写入失败不会产生半成品。
          if (isStreamUpload(file)) {
            await disk.delete(path).catch(() => undefined);
          }
          throw error;
        }
      }

      // 3. 图片文件：提取 Buffer 并快速解析元数据
      const rawBuffer = await this.getFileBuffer(file);
      let metadata: ImageMetadata | undefined;
      try {
        metadata = await this.img.getImageMetadata(rawBuffer);
      } catch {
        const path = await buildMediaPath(file, opts, rawBuffer);
        return await this.persistToDisk(disk, path, rawBuffer, file.mimetype, newlyCreatedPaths);
      }

      // 4. 生成主图存储路径并写入原图（Master Asset）
      const mainPath = await buildMediaPath(file, opts, rawBuffer);
      const mainResult = await this.persistToDisk(disk, mainPath, rawBuffer, file.mimetype, newlyCreatedPaths);

      // 5. 生成多规格变体 URL（通过 imgproxy JIT 动态签名生成，零物理磁盘占用）
      const variants = this.generateVariants(mainPath, opts);

      return {
        path: mainPath,
        url: mainResult.url,
        isNew: mainResult.isNew,
        variants,
        metadata: {
          ...metadata,
          size: rawBuffer.byteLength,
        },
      };
    } catch (error) {
      // 失败安全回滚：仅删除本次操作新创建的物理文件（不误删已有 deduplicated 共享物理文件）
      if (newlyCreatedPaths.length > 0) {
        await this.comp.deletePaths(disk, newlyCreatedPaths);
      }
      throw error;
    }
  }

  /**
   * 批量存储多个上传文件。
   * 串行处理，任一文件失败时自动回滚本次所有新写入的文件。
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
      }
      return savedResults;
    } catch (err) {
      if (createdPaths.length > 0) {
        await this.comp.deletePaths(disk, createdPaths);
        this.logger.warn(`批量媒体上传失败，已回滚 ${createdPaths.length} 个已写文件`);
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
    if (path) {
      await this.deleteStored(path, diskName);
    }
  }

  // ── 图像基础方法（委托 ImageProcessor） ─────────────────────────────────

  /** 判断是否为图像 MIME 类型或扩展名 */
  isImage(mimetype?: string, filename?: string): boolean {
    return this.img.isImage(mimetype, filename);
  }

  /** 提取图像元数据（分辨率、格式、尺寸、宽高比等） */
  async getImageMetadata(input: Buffer | string): Promise<ImageMetadata> {
    return this.img.getImageMetadata(input);
  }

  // ── 二维码生成与存储门面（委托 QrCodeProcessor） ─────────────────────────

  /** 生成二维码 Buffer（纯 JS/SVG 矢量渲染，支持 PNG / WebP / SVG，支持中心 Logo 合成） */
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
    disk: StorageDisk,
    path: string,
    content: Buffer | import('node:stream').Readable,
    contentType: string,
    newlyCreatedPaths: string[],
  ): Promise<MediaUploadResult> {
    const exists = await disk.exists(path).catch(() => false);
    if (!exists) newlyCreatedPaths.push(path);
    await disk.put(path, content, { contentType });
    return { path, url: disk.url(path), isNew: !exists };
  }

  private generateVariants(
    mainPath: string,
    opts: MediaSaveOptions | undefined,
  ): Record<string, MediaVariantResult> | undefined {
    const variantsConfig = opts?.variants;
    if (!variantsConfig || isEmptyObject(variantsConfig)) {
      return undefined;
    }

    const variants: Record<string, MediaVariantResult> = {};
    for (const [variantName, variantOpts] of Object.entries(variantsConfig)) {
      variants[variantName] = {
        path: mainPath,
        url: this.imgproxy.url(mainPath).resize(variantOpts).build(),
        isNew: false,
        status: 'ready',
      };
    }
    return variants;
  }

  /** 读取全量内容：内存载荷直接返回 buffer，流式载荷边读边聚合 */
  private async getFileBuffer(file: UploadedFile): Promise<Buffer> {
    if (!isStreamUpload(file)) {
      return file.buffer;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
  }
}

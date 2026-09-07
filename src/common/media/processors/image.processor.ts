import { extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { clamp } from 'es-toolkit';
import sharp, { type OutputInfo, type Sharp } from 'sharp';
import type { ImageFormat, ImageMetadata, ImageResizeOptions, MediaSaveOptions } from '../interfaces/media.interface';

export const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.svg']);

/** 图像格式转换策略分发表 */
export const FORMAT_APPLIERS: Record<ImageFormat, (pipeline: Sharp, quality: number) => Sharp> = {
  webp: (p, q) => p.webp({ quality: q }),
  png: (p, q) => p.png({ quality: clamp(q, 1, 100) }),
  jpeg: (p, q) => p.jpeg({ quality: q }),
};

/**
 * 图像处理专用引擎 (ImageProcessor)
 *
 * 专职 Sharp 图像纯计算与内存/流式转换：WebP 极速转码、EXIF 自动校正、多规格尺寸衍生、元数据提取。
 * 零 I/O 业务耦合、零队列耦合，纯粹且高吞吐。
 */
@Injectable()
export class ImageProcessor {
  /** 判断是否为受支持的图像 MIME 类型或扩展名 */
  isImage(mimetype?: string, filename?: string): boolean {
    if (mimetype?.toLowerCase().startsWith('image/')) return true;
    if (filename) {
      const ext = extname(filename).toLowerCase();
      return SUPPORTED_IMAGE_EXTS.has(ext);
    }
    return false;
  }

  /**
   * 独立将图像转换为 WebP 格式
   */
  async convertToWebp(
    input: Buffer | string,
    options?: { quality?: number },
  ): Promise<{ buffer: Buffer; info: OutputInfo }> {
    const quality = options?.quality ?? 80;
    const { data, info } = await sharp(input).rotate().webp({ quality }).toBuffer({ resolveWithObject: true });
    return { buffer: data, info };
  }

  /**
   * 独立对图像进行自动校正与优化（无格式变更）
   */
  async optimize(input: Buffer | string): Promise<{ buffer: Buffer; info: OutputInfo }> {
    const { data, info } = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
    return { buffer: data, info };
  }

  /**
   * 图像变换工具方法 — 支持尺寸缩放、裁剪、质量控制与格式转换
   */
  async transformImage(
    input: Buffer | string,
    options: ImageResizeOptions,
  ): Promise<{ buffer: Buffer; info: OutputInfo }> {
    let pipeline = sharp(input).rotate();

    if (options.width || options.height) {
      pipeline = pipeline.resize({
        width: options.width,
        height: options.height,
        fit: options.fit ?? 'cover',
        position: options.position ?? 'center',
        withoutEnlargement: true,
      });
    }

    const format = options.format ?? 'webp';
    const quality = options.quality ?? 80;

    const applier = FORMAT_APPLIERS[format] ?? FORMAT_APPLIERS.webp;
    pipeline = applier(pipeline, quality);

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, info };
  }

  /**
   * 提取图像元数据（分辨率、格式、透明度、宽高比等）
   */
  async getImageMetadata(input: Buffer | string): Promise<ImageMetadata> {
    const meta = await sharp(input).metadata();
    const size = Buffer.isBuffer(input) ? input.byteLength : (meta.size ?? 0);
    const width = meta.width;
    const height = meta.height;
    const aspectRatio = width && height ? Number((width / height).toFixed(4)) : undefined;

    return {
      width,
      height,
      format: meta.format,
      size,
      hasAlpha: meta.hasAlpha,
      orientation: meta.orientation,
      aspectRatio,
    };
  }

  /**
   * 处理主图内容（支持自动转 WebP 与无损优化）
   */
  async processMainImage(
    sourceBuffer: Buffer,
    defaultMime = 'application/octet-stream',
    opts?: MediaSaveOptions,
  ): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
    if (opts?.convertToWebp) {
      const { buffer } = await this.convertToWebp(sourceBuffer, { quality: opts.webpQuality ?? 80 });
      return { buffer, contentType: 'image/webp', ext: '.webp' };
    }

    if (opts?.optimize !== false) {
      const { buffer, info } = await this.optimize(sourceBuffer);
      return { buffer, contentType: `image/${info.format}`, ext: `.${info.format}` };
    }

    return { buffer: sourceBuffer, contentType: defaultMime, ext: '' };
  }
}

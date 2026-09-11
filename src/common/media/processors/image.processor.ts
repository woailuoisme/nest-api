import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { imageSize } from 'image-size';
import type { ImageMetadata } from '../interfaces/media.interface';

export const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.svg', '.avif']);

/**
 * 图像处理专用引擎 (ImageProcessor)
 *
 * 专职图像元数据提取与格式识别。
 * 纯 JavaScript 实现（基于 image-size），零 C++ 编译依赖、零原生 addon，跨平台性能卓越。
 * 复杂的缩放、裁切、优化与转码全权移交独立的 imgproxy 容器微服务处理。
 */
@Injectable()
export class ImageProcessor {
  /** 判断是否为受支持的图像 MIME 类型或扩展名 */
  isImage(mimetype?: string, filename?: string): boolean {
    if (mimetype?.toLowerCase().startsWith('image/')) return true;
    return filename ? SUPPORTED_IMAGE_EXTS.has(extname(filename).toLowerCase()) : false;
  }

  /**
   * 提取图像元数据（分辨率、格式、文件大小、宽高比、EXIF方向等）
   * 基于纯 JS image-size 高速解析，微秒级响应
   */
  async getImageMetadata(input: Buffer | string): Promise<ImageMetadata> {
    const buffer = typeof input === 'string' ? await fs.readFile(input) : input;
    const { width, height, type: format, orientation } = imageSize(buffer);
    const aspectRatio = width && height ? Number((width / height).toFixed(4)) : undefined;

    return {
      width,
      height,
      format,
      size: buffer.byteLength,
      orientation,
      aspectRatio,
    };
  }
}

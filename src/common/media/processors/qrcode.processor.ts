import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { Injectable, Optional } from '@nestjs/common';
import { clamp } from 'es-toolkit';
import * as QRCode from 'qrcode';

import type { StorageService } from '@/common/storage/storage.service';

import type {
  QrCodeErrorCorrectionLevel,
  QrCodeOptions,
  QrCodeSaveOptions,
  UploadResult,
} from '../interfaces/media.interface';

interface ResolvedQrOptions {
  width: number;
  margin: number;
  errorCorrectionLevel: QrCodeErrorCorrectionLevel;
  color: { dark: string; light: string };
  format: 'png' | 'webp' | 'svg';
  quality: number;
}

const EXT_MAP: Record<ResolvedQrOptions['format'], string> = { svg: '.svg', webp: '.webp', png: '.png' };
const MIME_MAP: Record<ResolvedQrOptions['format'], string> = {
  svg: 'image/svg+xml',
  webp: 'image/webp',
  png: 'image/png',
};

export interface LogoGeometry {
  boxSize: number;
  borderSize: number;
  innerSize: number;
  borderRadius: number;
  offset: number;
  innerOffset: number;
}

/** 计算二维码中心 Logo 及白底衬垫几何尺寸 */
export function calculateLogoGeometry(qrWidth: number, logoSizeRatio = 0.22): LogoGeometry {
  const ratio = clamp(logoSizeRatio, 0.1, 0.3);
  const boxSize = Math.round(qrWidth * ratio);
  const borderSize = Math.max(2, Math.round(boxSize * 0.08));
  const innerSize = boxSize - borderSize * 2;
  const borderRadius = Math.max(4, Math.round(boxSize * 0.12));
  const offset = Math.round((qrWidth - boxSize) / 2);
  const innerOffset = offset + borderSize;
  return { boxSize, borderSize, innerSize, borderRadius, offset, innerOffset };
}

/**
 * 专职二维码引擎 (QrCodeProcessor)
 *
 * 纯 JS / 矢量实现：提供高定制化二维码矩阵计算、SVG 矢量 XML 渲染、Logo 中心嵌入与持久化存盘。
 * 零原生 C++ 依赖。
 */
@Injectable()
export class QrCodeProcessor {
  constructor(@Optional() private readonly storage?: StorageService) {}

  /**
   * 生成二维码 Buffer（支持 PNG / SVG，支持中心 Logo 矢量嵌入）
   */
  async generateBuffer(content: string, options?: QrCodeOptions): Promise<Buffer> {
    const opts = this.resolveQrOptions(options);

    // 若包含 Logo 或指定 SVG 格式，统一采用 SVG 矢量 XML 生成以保全无损与跨平台一致性
    if (opts.format === 'svg' || options?.logo) {
      const svg = await this.generateSvg(content, options);
      return Buffer.from(svg, 'utf-8');
    }

    return QRCode.toBuffer(content, {
      type: 'png',
      width: opts.width,
      margin: opts.margin,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      color: opts.color,
    });
  }

  /**
   * 生成 Base64 / SVG Data URL 形式的二维码（方便前端直接绑定到 <img src="...">）
   */
  async generateDataUrl(content: string, options?: QrCodeOptions): Promise<string> {
    const opts = this.resolveQrOptions(options);

    if (opts.format === 'svg' || options?.logo) {
      const svg = await this.generateSvg(content, options);
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    return QRCode.toDataURL(content, {
      width: opts.width,
      margin: opts.margin,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      color: opts.color,
    });
  }

  /**
   * 生成 SVG 矢量 XML 字符串二维码（支持中心 Logo 嵌入）
   */
  async generateSvg(content: string, options?: QrCodeOptions): Promise<string> {
    const opts = this.resolveQrOptions(options);

    const svgString = await QRCode.toString(content, {
      type: 'svg',
      width: opts.width,
      margin: opts.margin,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      color: opts.color,
    });

    if (options?.logo) {
      const logoBuffer = Buffer.isBuffer(options.logo) ? options.logo : await fs.readFile(options.logo);
      const base64Logo = `data:image/png;base64,${logoBuffer.toString('base64')}`;
      const geo = calculateLogoGeometry(opts.width, options.logoSizeRatio);

      const logoSvgChunk = `<rect x="${geo.offset}" y="${geo.offset}" width="${geo.boxSize}" height="${geo.boxSize}" fill="#FFFFFF" rx="${geo.borderRadius}" ry="${geo.borderRadius}" /><image x="${geo.innerOffset}" y="${geo.innerOffset}" width="${geo.innerSize}" height="${geo.innerSize}" href="${base64Logo}" preserveAspectRatio="xMidYMid slice" /></svg>`;

      return svgString.replace('</svg>', logoSvgChunk);
    }

    return svgString;
  }

  /**
   * 生成二维码并直接上传持久化到存储驱动，返回存储路径与访问 URL
   */
  async generateAndStore(content: string, options?: QrCodeOptions, saveOpts?: QrCodeSaveOptions): Promise<UploadResult>;
  async generateAndStore(
    storage: StorageService,
    content: string,
    options?: QrCodeOptions,
    saveOpts?: QrCodeSaveOptions,
  ): Promise<UploadResult>;
  async generateAndStore(
    first: string | StorageService,
    second?: string | QrCodeOptions,
    third?: QrCodeOptions | QrCodeSaveOptions,
    fourth?: QrCodeSaveOptions,
  ): Promise<UploadResult> {
    const isFirstString = typeof first === 'string';
    const storage = isFirstString ? this.storage : first;
    if (!storage) {
      throw new Error('QrCodeProcessor 未注入 StorageService，无法直接执行存盘。请在参数中显式传递 StorageService。');
    }
    const content = isFirstString ? first : (second as string);
    const options = (isFirstString ? second : third) as QrCodeOptions | undefined;
    const saveOpts = (isFirstString ? third : fourth) as QrCodeSaveOptions | undefined;

    const resolved = this.resolveQrOptions(options);
    const finalFormat = options?.logo ? 'svg' : resolved.format;
    const contentData =
      finalFormat === 'svg' ? await this.generateSvg(content, options) : await this.generateBuffer(content, options);

    const prefix = saveOpts?.prefix ?? 'qrcodes';
    const filename = `${saveOpts?.filename ?? randomUUID()}${EXT_MAP[finalFormat]}`;
    const filePath = `${prefix}/${filename}`.replace(/^\/+/, '');
    const disk = storage.disk(saveOpts?.disk);

    await disk.put(filePath, contentData, {
      contentType: MIME_MAP[finalFormat],
    });

    const url = disk.url(filePath);
    return { path: filePath, url };
  }

  /**
   * 解析与归一化选项，设定企业级默认值
   */
  private resolveQrOptions(options?: QrCodeOptions): ResolvedQrOptions {
    const width = clamp(options?.width ?? 256, 64, 4096);
    const margin = clamp(options?.margin ?? 2, 0, 10);
    const errorCorrectionLevel = options?.logo ? 'H' : (options?.errorCorrectionLevel ?? 'M');
    const format = options?.format ?? 'png';
    const quality = clamp(options?.quality ?? 85, 1, 100);

    const color = {
      dark: options?.color?.dark ?? '#000000',
      light: options?.color?.light ?? '#FFFFFF',
    };

    return { width, margin, errorCorrectionLevel, color, format, quality };
  }
}

/** 兼容别名导出 */
export { QrCodeProcessor as QrCodeService };

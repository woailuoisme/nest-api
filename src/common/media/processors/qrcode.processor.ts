import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Injectable, Optional } from '@nestjs/common';
import { clamp } from 'es-toolkit';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
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
 * 提供高定制化二维码矩阵计算、SVG 矢量 XML 渲染、Logo 中心合成与持久化存盘。
 */
@Injectable()
export class QrCodeProcessor {
  constructor(@Optional() private readonly storage?: StorageService) {}

  /**
   * 生成二维码 Buffer（支持 PNG / WebP / SVG，支持中心 Logo 合成）
   */
  async generateBuffer(content: string, options?: QrCodeOptions): Promise<Buffer> {
    const opts = this.resolveQrOptions(options);

    if (opts.format === 'svg') {
      const svg = await this.generateSvg(content, options);
      return Buffer.from(svg, 'utf-8');
    }

    const qrPngBuffer = await QRCode.toBuffer(content, {
      type: 'png',
      width: opts.width,
      margin: opts.margin,
      errorCorrectionLevel: opts.errorCorrectionLevel,
      color: opts.color,
    });

    let resultBuffer = qrPngBuffer;

    if (options?.logo) {
      resultBuffer = await this.compositeLogo(qrPngBuffer, options.logo, opts.width, options.logoSizeRatio);
    }

    if (opts.format === 'webp') {
      return sharp(resultBuffer).webp({ quality: opts.quality }).toBuffer();
    }

    return resultBuffer;
  }

  /**
   * 生成 Base64 / SVG Data URL 形式的二维码（方便前端直接绑定到 <img src="...">）
   */
  async generateDataUrl(content: string, options?: QrCodeOptions): Promise<string> {
    const opts = this.resolveQrOptions(options);

    if (opts.format === 'svg') {
      const svg = await this.generateSvg(content, options);
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    if (options?.logo || opts.format === 'webp') {
      const buf = await this.generateBuffer(content, options);
      return `data:${MIME_MAP[opts.format]};base64,${buf.toString('base64')}`;
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
      const pngLogo = await sharp(logoBuffer).png().toBuffer();
      const base64Logo = `data:image/png;base64,${pngLogo.toString('base64')}`;
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
    arg1: string | StorageService,
    arg2?: string | QrCodeOptions,
    arg3?: QrCodeOptions | QrCodeSaveOptions,
    arg4?: QrCodeSaveOptions,
  ): Promise<UploadResult> {
    let storage: StorageService;
    let content: string;
    let options: QrCodeOptions | undefined;
    let saveOpts: QrCodeSaveOptions | undefined;

    if (typeof arg1 === 'string') {
      if (!this.storage) {
        throw new Error('未注入 StorageService，必须通过参数传入 StorageService 实例');
      }
      storage = this.storage;
      content = arg1;
      options = arg2 as QrCodeOptions | undefined;
      saveOpts = arg3 as QrCodeSaveOptions | undefined;
    } else {
      storage = arg1;
      content = arg2 as string;
      options = arg3 as QrCodeOptions | undefined;
      saveOpts = arg4;
    }

    const disk = storage.disk(saveOpts?.disk);
    const prefix = saveOpts?.prefix ?? 'qrcodes';
    const opts = this.resolveQrOptions(options);
    const filename = saveOpts?.filename ?? `${randomUUID()}${EXT_MAP[opts.format]}`;
    const path = `${prefix}/${filename}`;

    const data =
      opts.format === 'svg' ? await this.generateSvg(content, options) : await this.generateBuffer(content, options);
    await disk.put(path, data, { contentType: MIME_MAP[opts.format] });

    return {
      path,
      url: disk.getUrl(path),
    };
  }

  /** 归一化解析二维码配置 */
  private resolveQrOptions(options?: QrCodeOptions): ResolvedQrOptions {
    const width = options?.width ?? 300;
    const margin = options?.margin ?? 2;
    const errorCorrectionLevel = options?.logo ? 'H' : (options?.errorCorrectionLevel ?? 'M');
    const format = options?.format ?? 'png';
    const quality = options?.quality ?? 90;
    const color = {
      dark: options?.color?.dark ?? '#000000',
      light: options?.color?.light ?? '#FFFFFF',
    };

    return { width, margin, errorCorrectionLevel, color, format, quality };
  }

  /** 在二维码中心合成 Logo 图标 */
  private async compositeLogo(
    qrBuffer: Buffer,
    logo: Buffer | string,
    qrWidth: number,
    logoRatio = 0.22,
  ): Promise<Buffer> {
    const logoBuffer = Buffer.isBuffer(logo) ? logo : await fs.readFile(logo);
    const geo = calculateLogoGeometry(qrWidth, logoRatio);

    const resizedLogo = await sharp(logoBuffer).resize(geo.innerSize, geo.innerSize, { fit: 'cover' }).toBuffer();

    const badgeSvg = Buffer.from(
      `<svg width="${geo.boxSize}" height="${geo.boxSize}"><rect width="${geo.boxSize}" height="${geo.boxSize}" rx="${geo.borderRadius}" ry="${geo.borderRadius}" fill="#FFFFFF"/></svg>`,
    );

    const logoBadge = await sharp(badgeSvg)
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toBuffer();

    return sharp(qrBuffer)
      .composite([{ input: logoBadge, gravity: 'center' }])
      .toBuffer();
  }
}

/** 兼容别名导出 */
export { QrCodeProcessor as QrCodeService };

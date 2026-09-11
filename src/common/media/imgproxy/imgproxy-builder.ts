import { createHmac } from 'node:crypto';
import { clamp, compact } from 'es-toolkit';
import {
  IMGPROXY_PRESETS,
  type ImgproxyConfig,
  type ImgproxyFormat,
  type ImgproxyGravity,
  type ImgproxyResizeOptions,
  type ImgproxyResizingType,
} from './imgproxy.interface';

const FIT_TO_RESIZING_TYPE: Record<string, ImgproxyResizingType> = {
  cover: 'fill',
  contain: 'fit',
  inside: 'fit',
  fill: 'force',
  outside: 'auto',
};

const POSITION_TO_GRAVITY: Record<string, ImgproxyGravity> = {
  center: 'ce',
  top: 'no',
  bottom: 'so',
  left: 'we',
  right: 'ea',
  entropy: 'sm',
  attention: 'sm',
};

/**
 * 将十六进制或纯文本字符串安全解码为 Buffer
 */
function decodeSecret(secret: string): Buffer {
  const isHex = /^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0;
  return isHex ? Buffer.from(secret, 'hex') : Buffer.from(secret, 'utf-8');
}

/**
 * Imgproxy 安全签名与 Fluent URL 构建器
 *
 * 遵循 imgproxy 官方 HMAC-SHA256 签名规范：
 * 1. 签名串为 `salt + path_to_sign`（以 '/' 开头）
 * 2. 使用 key 密钥进行 HMAC-SHA256 计算
 * 3. 对摘要执行 URL-safe Base64 编码（无填充字符）
 */
export class ImgproxyBuilder {
  private _resize?: ImgproxyResizeOptions;
  private _format?: ImgproxyFormat;
  private _quality?: number;
  private _blur?: number;

  constructor(
    private readonly sourcePath: string,
    private readonly config: ImgproxyConfig | null,
    private readonly storageDriver: 'local' | 's3' = 'local',
    private readonly s3Bucket?: string,
    private readonly fallbackBaseUrl?: string,
  ) {}

  /**
   * 应用常用命名预设（如 'avatar', 'thumb', 'small', 'medium', 'large'）
   */
  preset(presetName: string): this {
    const p = IMGPROXY_PRESETS[presetName];
    if (p) {
      if (p.resize) this._resize = { ...this._resize, ...p.resize };
      if (p.format) this._format = p.format;
      if (p.quality) this._quality = p.quality;
      if (p.blur) this._blur = p.blur;
    }
    return this;
  }

  /**
   * 设置尺寸与缩放模式（兼容 ImgproxyResizeOptions 与 ImageResizeOptions）
   */
  resize(options: ImgproxyResizeOptions | import('../interfaces/media.interface').ImageResizeOptions): this;
  resize(width: number, height?: number, mode?: ImgproxyResizingType): this;
  resize(
    optsOrWidth: ImgproxyResizeOptions | import('../interfaces/media.interface').ImageResizeOptions | number,
    height?: number,
    mode: ImgproxyResizingType = 'fit',
  ): this {
    if (typeof optsOrWidth === 'number') {
      this._resize = { width: optsOrWidth, height, resizingType: mode };
    } else {
      const opts = optsOrWidth as {
        resizingType?: ImgproxyResizingType;
        fit?: string;
        position?: string;
        gravity?: ImgproxyGravity;
        width?: number;
        height?: number;
        enlarge?: boolean;
        extend?: boolean;
        quality?: number;
        format?: ImgproxyFormat;
      };
      const resizingType = opts.resizingType ?? (opts.fit ? FIT_TO_RESIZING_TYPE[opts.fit] : undefined);
      const gravity = opts.gravity ?? (opts.position ? (POSITION_TO_GRAVITY[opts.position] ?? 'ce') : undefined);

      this._resize = {
        ...this._resize,
        width: opts.width,
        height: opts.height,
        resizingType: resizingType ?? this._resize?.resizingType,
        enlarge: opts.enlarge ?? this._resize?.enlarge,
        extend: opts.extend ?? this._resize?.extend,
        gravity: gravity ?? this._resize?.gravity,
      };
      if (opts.quality !== undefined) {
        this._quality = opts.quality;
      }
      if (opts.format) {
        this._format = opts.format;
      }
    }
    return this;
  }

  /**
   * 指定输出格式
   */
  format(fmt: ImgproxyFormat): this {
    this._format = fmt;
    return this;
  }

  private setFormat(fmt: ImgproxyFormat, quality?: number): this {
    this._format = fmt;
    if (quality !== undefined) this._quality = quality;
    return this;
  }

  /** 快捷方式：转为 WebP 格式 */
  webp(quality?: number): this {
    return this.setFormat('webp', quality);
  }

  /** 快捷方式：转为 PNG 格式 */
  png(quality?: number): this {
    return this.setFormat('png', quality);
  }

  /** 快捷方式：转为 JPEG 格式 */
  jpeg(quality?: number): this {
    return this.setFormat('jpeg', quality);
  }

  /** 快捷方式：转为 AVIF 格式 */
  avif(quality?: number): this {
    return this.setFormat('avif', quality);
  }

  /** 设置压缩质量 (1-100) */
  quality(q: number): this {
    this._quality = clamp(q, 1, 100);
    return this;
  }

  /** 设置模糊半径 */
  blur(sigma: number): this {
    this._blur = sigma;
    return this;
  }

  /**
   * 设置焦点 / 智能裁剪锚点
   */
  gravity(g: ImgproxyGravity): this {
    this._resize = { ...this._resize, gravity: g };
    return this;
  }

  /**
   * 构建带有 HMAC-SHA256 签名的最终安全 URL
   */
  build(): string {
    // 降级兜底：若未配置 imgproxy，直接回退为存储服务的原生访问路径
    if (!this.config) {
      return this.fallbackBaseUrl
        ? `${this.fallbackBaseUrl.replace(/\/+$/, '')}/${this.sourcePath.replace(/^\/+/, '')}`
        : this.sourcePath;
    }

    const sourceUri = this.resolveSourceUri();
    const optionsPath = this.buildOptionsPath();
    const formatExt = this._format ? `@${this._format}` : '';

    // 拼装待签名的路径部分，例如: /rs:fill:300:300:0:0/g:ce/q:80/plain/local:///uploads/abc.png@webp
    const cleanOptions = optionsPath ? `/${optionsPath.replace(/^\/+|\/+$/g, '')}` : '';
    const pathToSign = `${cleanOptions}/plain/${sourceUri}${formatExt}`;

    // 计算 HMAC-SHA256 签名
    const keyBin = decodeSecret(this.config.key);
    const saltBin = decodeSecret(this.config.salt);

    const hmac = createHmac('sha256', keyBin);
    hmac.update(saltBin);
    hmac.update(pathToSign);
    const signature = hmac.digest('base64url');

    return `${this.config.publicUrl}/${signature}${pathToSign}`;
  }

  /**
   * 根据当前存储驱动将相对路径解析为 imgproxy 受支持的协议 URI
   */
  private resolveSourceUri(): string {
    const cleanPath = this.sourcePath.replace(/^\/+/, '');

    // 已自带绝对协议前缀
    if (/^(local:\/\/|s3:\/\/|https?:\/\/)/.test(cleanPath)) {
      return cleanPath;
    }

    return this.storageDriver === 's3' ? `s3://${this.s3Bucket || 'default'}/${cleanPath}` : `local:///${cleanPath}`;
  }

  /**
   * 序列化处理参数为 imgproxy 短指令段落
   */
  private buildOptionsPath(): string {
    const resizeSegments = this._resize
      ? [
          `rs:${this._resize.resizingType ?? 'fit'}:${this._resize.width ?? 0}:${this._resize.height ?? 0}:${this._resize.enlarge ? 1 : 0}:${this._resize.extend ? 1 : 0}`,
          this._resize.gravity ? `g:${this._resize.gravity}` : null,
        ]
      : [];

    return compact([
      ...resizeSegments,
      this._quality !== undefined ? `q:${this._quality}` : null,
      this._blur !== undefined ? `bl:${this._blur}` : null,
    ]).join('/');
  }
}

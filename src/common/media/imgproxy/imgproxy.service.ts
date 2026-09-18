import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseImgproxyDsn } from './dsn.parser';
import type { ImgproxyConfig } from './imgproxy.interface';
import { ImgproxyBuilder } from './imgproxy-builder';

/**
 * 从 STORAGE_S3_URL 中解析 bucket 名称（如 s3://key:secret@endpoint:port/bucket）
 * 解析异常或缺少 bucket 时返回 undefined，交由调用方走默认值
 */
function parseS3Bucket(s3Url?: string): string | undefined {
  if (!s3Url) {
    return undefined;
  }
  try {
    const parsed = new URL(s3Url.replace(/^s3:\/\//, 'http://'));
    const [bucket] = parsed.pathname.split('/').filter(Boolean);
    return bucket || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 统一 imgproxy 动态图像处理服务 (ImgproxyService)
 *
 * 管理连接凭据、感知底层存储拓扑（Local 挂载 vs S3 桶协议），
 * 负责分发带有 HMAC-SHA256 签名校验的高性能图片处理构建器。
 */
@Injectable()
export class ImgproxyService {
  private readonly logger = new Logger(ImgproxyService.name);
  private readonly config: ImgproxyConfig | null = null;
  private readonly storageDriver: 'local' | 's3';
  private readonly s3Bucket?: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.appUrl = this.configService.get<string>('APP_URL') ?? 'http://localhost:4300';
    this.storageDriver = this.configService.get<'local' | 's3'>('STORAGE_DRIVER') ?? 'local';
    this.s3Bucket = parseS3Bucket(this.configService.get<string>('STORAGE_S3_URL'));

    const dsn = this.configService.get<string>('IMGPROXY_URL');
    if (dsn) {
      try {
        this.config = parseImgproxyDsn(dsn);
        this.logger.log(`imgproxy 服务已就绪: [${this.config.endpoint}] (Public: ${this.config.publicUrl})`);
      } catch (err) {
        this.logger.error(`imgproxy DSN 解析失败: ${(err as Error).message}. 将降级为原生存储直链模式。`);
      }
    }
  }

  /**
   * 判断 imgproxy 服务是否已有效配置与启用
   */
  isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * 获取 imgproxy 服务内部地址（供健康检查探针使用）
   */
  getEndpoint(): string | null {
    return this.config?.endpoint ?? null;
  }

  /**
   * 获取对外公开的基础 URL
   */
  getPublicUrl(): string | null {
    return this.config?.publicUrl ?? null;
  }

  /**
   * 获取 imgproxy 配置对象（浅拷贝）
   */
  getConfig(): ImgproxyConfig | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * 创建指定相对路径的图片处理 Fluent 构建器
   *
   * @param sourcePath 存储文件相对路径（如 media/20260813/abc.png）
   * @example
   * ```ts
   * const avatarUrl = imgproxyService.url(user.avatarPath).preset('avatar').build();
   * const thumbUrl = imgproxyService.url(filePath).resize({ width: 300, height: 300 }).webp().build();
   * ```
   */
  url(sourcePath: string): ImgproxyBuilder {
    return new ImgproxyBuilder(sourcePath, this.config, this.storageDriver, this.s3Bucket, `${this.appUrl}/uploads`);
  }
}

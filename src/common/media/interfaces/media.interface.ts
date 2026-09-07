import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';

/** 上传返回基础结构 — 同时提供存储相对路径与公开 URL */
export interface UploadResult {
  /** 存储相对路径（如 media/20260813/abc.png），可用于 delete/exists 等操作 */
  path: string;
  /** 公开访问 URL（由 StorageDriver.getUrl 生成，如 /uploads/media/20260813/abc.png） */
  url: string;
}

/** 命名策略类型枚举 */
export type NamingStrategyType = 'date-uuid' | 'hash' | 'slug-random' | 'custom';

/** 自定义命名生成器函数 */
export type NamingStrategyFn = (
  file: UploadedFile,
  options?: MediaSaveOptions,
  contentBuffer?: Buffer,
) => string | Promise<string>;

/** 支持的图像输出格式 */
export type ImageFormat = 'webp' | 'png' | 'jpeg';

/** 图像缩放与裁剪选项 */
export interface ImageResizeOptions {
  /** 目标宽度（像素） */
  width?: number;
  /** 目标高度（像素） */
  height?: number;
  /** 裁剪缩放适配模式：cover (居中裁剪填充), contain (等比缩放留白), fill (拉伸填满), inside (等比缩放不超出), outside (等比缩放填满) */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  /** 裁剪锚点位置：center, top, bottom, left, right, entropy (高信息熵智能裁剪), attention (人脸/视觉焦点智能裁剪) */
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'entropy' | 'attention';
  /** 输出质量 (1-100，默认 80) */
  quality?: number;
  /** 输出图像格式 (默认 'webp') */
  format?: ImageFormat;
}

/** 常用缩略图预设配置字典 */
export const THUMBNAIL_PRESETS: Record<string, ImageResizeOptions> = {
  /** 头像/图标缩略图 (150x150 居中裁剪) */
  thumb: { width: 150, height: 150, fit: 'cover', format: 'webp', quality: 80 },
  /** 小图/列表预览 (300xauto) */
  small: { width: 300, fit: 'inside', format: 'webp', quality: 80 },
  /** 中图/详情卡片 (600xauto) */
  medium: { width: 600, fit: 'inside', format: 'webp', quality: 82 },
  /** 大图/轮播高清 (1200xauto) */
  large: { width: 1200, fit: 'inside', format: 'webp', quality: 85 },
};

/** 图像元数据 */
export interface ImageMetadata {
  /** 图像宽度 (像素) */
  width?: number;
  /** 图像高度 (像素) */
  height?: number;
  /** 图像格式 (如 'png', 'jpeg', 'webp') */
  format?: string;
  /** 文件大小 (字节) */
  size: number;
  /** 是否包含 Alpha 透明通道 */
  hasAlpha?: boolean;
  /** EXIF 旋转方向 */
  orientation?: number;
  /** 宽高比 (width / height) */
  aspectRatio?: number;
}

/** 媒体上传与处理选项 */
export interface MediaSaveOptions {
  /** 存储路径前缀，默认 'media' */
  prefix?: string;
  /** 命名策略：'date-uuid' (默认) | 'hash' (内容去重) | 'slug-random' (SEO友好) | 自定义函数 */
  naming?: NamingStrategyType | NamingStrategyFn;
  /** 指定存储磁盘 (如 'local', 's3') */
  disk?: string;
  /** 是否自动依据 EXIF 旋转校正并优化图片，默认 true */
  optimize?: boolean;
  /** 是否将主图自动转换为 WebP 格式，默认 false */
  convertToWebp?: boolean;
  /** WebP 转换质量 (1-100)，默认 80 */
  webpQuality?: number;
  /** 缩略图与衍生规格定义字典 (如 { thumb: { width: 150, height: 150 }, medium: { width: 600 } }) */
  variants?: Record<string, ImageResizeOptions>;
  /** 是否启用 BullMQ 队列异步处理多规格变体。未传时遵从环境变量 MEDIA_QUEUE_ENABLED (默认 true) */
  asyncQueue?: boolean;
}

/** 媒体单项存储结果（含是否新生成标记与就绪状态，保障去重安全回滚与异步响应） */
export interface MediaVariantResult extends UploadResult {
  /** 是否为本次操作新建的物理文件（若 hash 命中已有文件则为 false） */
  isNew?: boolean;
  /** 变体就绪状态：'ready' (同步生成完毕) | 'pending' (已进入 BullMQ 队列后台生成中) */
  status?: 'ready' | 'pending';
  /** 后台任务 ID (若进入异步队列处理) */
  jobId?: string;
}

/** 媒体上传最终返回结果 */
export interface MediaUploadResult extends UploadResult {
  /** 是否为本次操作新建的物理文件（若 hash 命中已有文件则为 false，防止补偿回滚误删） */
  isNew?: boolean;
  /** 多规格缩略图与衍生文件字典映射 (如 { thumb: { path, url, isNew }, medium: { path, url, isNew } }) */
  variants?: Record<string, MediaVariantResult>;
  /** 图像元数据 (若上传文件为图像) */
  metadata?: ImageMetadata;
}

/** 事务补偿清理选项 */
export interface MediaCleanupOptions {
  /** 单个旧文件 URL（快捷传参） */
  oldUrl?: string | null;
  /** 多个旧文件 URL 列表 */
  oldUrls?: (string | null | undefined)[];
}

/** 二维码持久化存储选项 */
export interface QrCodeSaveOptions {
  /** 存储路径前缀，默认 'qrcodes' */
  prefix?: string;
  /** 自定义文件名 (包含扩展名)，未传则生成 UUID */
  filename?: string;
  /** 指定存储磁盘 (如 'local', 's3') */
  disk?: string;
}

/** 二维码容错级别 */
export type QrCodeErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** 二维码生成选项 */
export interface QrCodeOptions {
  /** 二维码图片宽度/高度 (像素，正方形)，默认 300 */
  width?: number;
  /** 二维码外边框空白模块数，默认 2 */
  margin?: number;
  /** 容错级别：'L' (7%), 'M' (15%), 'Q' (25%), 'H' (30%)。嵌入 Logo 时推荐 'H'，默认 'M' */
  errorCorrectionLevel?: QrCodeErrorCorrectionLevel;
  /** 前景与背景颜色配置 */
  color?: {
    /** 前景颜色十六进制 (如 '#000000') */
    dark?: string;
    /** 背景颜色十六进制 (如 '#FFFFFF' 或 '#00000000' 透明) */
    light?: string;
  };
  /** 中心嵌入 Logo (Buffer 或本地文件绝对路径) */
  logo?: Buffer | string;
  /** Logo 占二维码宽度的比例 (0.1 ~ 0.3，默认 0.22) */
  logoSizeRatio?: number;
  /** 输出格式：'png' (默认) | 'webp' | 'svg' */
  format?: 'png' | 'webp' | 'svg';
  /** 输出图像质量 (1-100)，默认 90 */
  quality?: number;
}

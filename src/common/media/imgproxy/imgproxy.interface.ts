/**
 * imgproxy 核心配置与参数契约定义
 */

/** imgproxy 统一连接与签名配置 */
export interface ImgproxyConfig {
  /** 签名密钥 (Hex 编码或纯文本) */
  key: string;
  /** 签名 Salt (Hex 编码或纯文本) */
  salt: string;
  /** 内部微服务通信地址 (如 http://imgproxy:8080) */
  endpoint: string;
  /** 对外公开访问基础 URL (如 http://localhost:8080 或 https://img.domain.com) */
  publicUrl: string;
}

/** 缩放与裁剪策略 */
export type ImgproxyResizingType = 'fit' | 'fill' | 'auto' | 'force';

/** 焦点 / 智能裁剪锚点 */
export type ImgproxyGravity =
  | 'no' // 北 / 顶部居中
  | 'so' // 南 / 底部居中
  | 'ea' // 东 / 右侧居中
  | 'we' // 西 / 左侧居中
  | 'noea' // 东北 / 右上
  | 'nowe' // 西北 / 左上
  | 'soea' // 东南 / 右下
  | 'sowe' // 西南 / 左下
  | 'ce' // 绝对居中
  | 'sm'; // Smart 智能边缘 / 人脸识别

/** 支持的目标转码格式 */
export type ImgproxyFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'ico' | 'svg' | 'tiff' | 'bmp';

/** 尺寸与缩放参数 */
export interface ImgproxyResizeOptions {
  width?: number;
  height?: number;
  resizingType?: ImgproxyResizingType;
  enlarge?: boolean;
  extend?: boolean;
  gravity?: ImgproxyGravity;
}

/** 命名预设参数 */
export interface ImgproxyPresetOptions {
  resize?: ImgproxyResizeOptions;
  format?: ImgproxyFormat;
  quality?: number;
  blur?: number;
}

/**
 * 常用命名预设字典
 */
export const IMGPROXY_PRESETS: Record<string, ImgproxyPresetOptions> = {
  avatar: {
    resize: { width: 200, height: 200, resizingType: 'fill', gravity: 'ce' },
    format: 'webp',
    quality: 85,
  },
  thumb: {
    resize: { width: 150, height: 150, resizingType: 'fill', gravity: 'ce' },
    format: 'webp',
    quality: 80,
  },
  small: {
    resize: { width: 320, resizingType: 'fit' },
    format: 'webp',
    quality: 80,
  },
  medium: {
    resize: { width: 768, resizingType: 'fit' },
    format: 'webp',
    quality: 85,
  },
  large: {
    resize: { width: 1280, resizingType: 'fit' },
    format: 'webp',
    quality: 85,
  },
};

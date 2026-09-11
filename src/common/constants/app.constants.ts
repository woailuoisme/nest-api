/**
 * 全局应用常量 — 统一管理路径、路由、分页、注入令牌等硬编码值，
 * 避免散落在各模块中的魔法值和不一致定义。
 */
export const APP_VERSION = '0.1.0';

/** APP_ENV 值（Laravel 风格：local/testing/production） */
export const APP_ENV_VALUES = {
  PRODUCTION: 'production',
  LOCAL: 'local',
  TESTING: 'testing',
} as const;

/** 是否为生产环境（模块工厂阶段 ConfigService 不可用，统一读 process.env 判定） */
export function isProductionEnv(): boolean {
  return process.env.APP_ENV === APP_ENV_VALUES.PRODUCTION;
}

/** 文件系统路径常量 — 统一管理全系统运行时数据与存储目录 */
export const PATHS = {
  STORAGE_ROOT: 'storage',
  STORAGE_UPLOADS: 'storage/uploads',
  STORAGE_LOGS: 'storage/logs',
  STORAGE_TMP: 'storage/tmp',
  STORAGE_CACHE: 'storage/cache',
  API_MD_FILE: 'docs/api.md',
  AVATARS_RELATIVE_PATH: '/uploads/avatars',
} as const;

/** API 路由常量 */
export const ROUTES = {
  HEALTH: 'health',
  DOCS: 'docs',
  DOCS_JSON: 'docs-json',
  ADMIN_DOCS: 'docs/admin',
  ADMIN_DOCS_JSON: 'docs-admin-json',
  AUTH_DOCS: 'docs/auth',
  AUTH_DOCS_JSON: 'docs-auth-json',
  QUEUES: 'queues',
} as const;

/** 排除版本控制的基础设施与运维路由 */
export const EXCLUDED_ROUTES = [
  '/',
  ROUTES.HEALTH,
  ROUTES.DOCS,
  ROUTES.DOCS_JSON,
  ROUTES.ADMIN_DOCS,
  ROUTES.ADMIN_DOCS_JSON,
  ROUTES.AUTH_DOCS,
  ROUTES.AUTH_DOCS_JSON,
  ROUTES.QUEUES,
] as const;

/** 服务网络常量 */
export const NETWORK = {
  HOST_BINDING: '0.0.0.0',
  DEFAULT_PORT: 4300,
} as const;

/** OpenAPI / Swagger 常量 */
export const OPENAPI_VERSION = '3.1.0';

/** 分页常量 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PER_PAGE: 20,
  MAX_PER_PAGE: 100,
} as const;

/** i18n 国际化常量 */
export const I18N = {
  FALLBACK_LANG: 'zh',
  LANG_QUERY: 'lang',
  LANG_HEADER: 'x-lang',
} as const;

/** 文件上传限制常量 — 全局默认值可由 UPLOAD_* env 覆盖 */
export const UPLOAD = {
  /** 全局默认单文件大小上限（字节） */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  /** 全局默认允许的 MIME 类型 */
  ALLOWED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  /** 全局默认允许的扩展名（含点号前缀，用于 extname 对比） */
  ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp'],
  /** 头像上传收紧限制 — 在全局默认之上收紧 */
  AVATAR: {
    /** 头像大小上限（字节） */
    MAX_SIZE_BYTES: 2 * 1024 * 1024, // 2MB
    /** 允许的头像扩展名（含点号前缀，用于 extname 对比） */
    ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp'],
  },
} as const;

/** 便捷别名 — 直接 import 使用 */
export const ALLOWED_MIME_TYPES = UPLOAD.ALLOWED_MIME_TYPES;
export const ALLOWED_EXTENSIONS = UPLOAD.ALLOWED_EXTENSIONS;
export const MAX_FILE_SIZE_BYTES = UPLOAD.MAX_FILE_SIZE_BYTES;

/** Redis 连接常量 */
export const REDIS_MAX_RETRIES = 3;

/** Snowflake ID 生成器常量 */
export const SNOWFLAKE = {
  /** 自定义纪元 (2024-01-01T00:00:00.000Z)，避免 ID 过长 */
  EPOCH: new Date('2024-01-01').getTime(),
  /** Worker ID 位数 */
  WORKER_ID_BITS: 10,
  /** 每毫秒序列号位数 */
  SEQUENCE_BITS: 12,
} as const;

/** OTP 验证码常量 */
export const OTP = {
  /** 验证码长度 */
  LENGTH: 6,
} as const;

/** 依赖注入令牌 */
export const INJECTION_TOKENS = {
  REDIS_CLIENT: 'REDIS_CLIENT',
} as const;

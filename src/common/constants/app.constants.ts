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

/**
 * 本地默认数据库连接（仅非生产环境使用）。
 *
 * 生产环境必须显式配置 `DB_URL`，缺省由 env 校验中止启动，绝不会静默回退到本值。
 * 本文件零依赖，drizzle-kit 等根级工具可直接相对引入。
 */
export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/nest-api';

/** 应用名默认值：`APP_NAME` 未配置（或为空）时使用 */
export const DEFAULT_APP_NAME = 'nest-api';

/**
 * 公开的开发用 JWT 签名密钥。
 *
 * 仅限非生产环境：生产环境除「必填」外还必须校验「不得等于此值」，
 * 否则从旧模板拷贝 `.env` 的部署会带着公开密钥静默上线。
 */
export const DEV_ONLY_JWT_SECRET = 'nestforge-dev-only-jwt-secret-32-chars!!';

/** 公开的开发用 MFA 加密密钥（同样禁止在生产环境使用） */
export const DEV_ONLY_MFA_KEY = 'nestforge-dev-only-mfa-encryption-key-32ch';

/**
 * 公开的开发用 IoT 设备胡椒值（Pepper）。
 *
 * 与 `DEV_ONLY_AUTH_SECRET` 同理：生产环境必须显式配置且不得等于此值，
 * 否则设备密钥摘要会在所有「拷模板上线」的部署间共享同一个胡椒，令摘要抗暴破能力归零。
 */
export const DEV_ONLY_IOT_PEPPER = 'nestforge-iot-device-pepper-v1';

/**
 * 应用名（品牌唯一来源）：由 `APP_NAME` 决定，默认 `nest-api`。
 *
 * 日志 / OTel 服务名 / 邮件发件人 / 短信正文 / 2FA 发行方 / IoT 指令标记统一引用此函数，
 * 不再各自写死。直接读 `process.env`：上述消费方大多在 ConfigModule 生效之前或之外构建，
 * 与 `isProductionEnv()` 同属引导期可用的零依赖读取（各入口首行均 `import 'dotenv/config'`）。
 */
export function appName(): string {
  return process.env.APP_NAME?.trim() || DEFAULT_APP_NAME;
}

/** 是否为生产环境（模块工厂阶段 ConfigService 不可用，统一读 process.env 判定） */
export function isProductionEnv(): boolean {
  return process.env.APP_ENV === APP_ENV_VALUES.PRODUCTION;
}

/**
 * Laravel FILTER_VALIDATE_BOOLEAN 语义的布尔解析：'true'/'1'/'on'/'yes' → true，其余（含未定义/空串）→ false。
 * 模块工厂阶段（ConfigService 尚不可用）与 zod env 校验共用同一真值集合，避免两处判定漂移。
 */
export function isTruthyEnv(value: unknown): boolean {
  return ['true', '1', 'on', 'yes'].includes(String(value).toLowerCase());
}

/** 文件系统路径常量 — 统一管理全系统运行时数据与存储目录 */
export const PATHS = {
  STORAGE_ROOT: 'storage',
  STORAGE_UPLOADS: 'storage/uploads',
  STORAGE_TMP: 'storage/tmp',
  STORAGE_CACHE: 'storage/cache',
  API_MD_FILE: 'docs/api.md',
  AVATARS_RELATIVE_PATH: '/uploads/avatars',
} as const;

/** API 路由常量 */
export const ROUTES = {
  READYZ: 'readyz',
  LIVEZ: 'livez',
  DOCS: 'docs',
  DOCS_JSON: 'docs-json',
  ADMIN_DOCS: 'docs/admin',
  ADMIN_DOCS_JSON: 'docs-admin-json',
  AUTH_DOCS: 'docs/auth',
  AUTH_DOCS_JSON: 'docs-auth-json',
} as const;

/** 排除版本控制的基础设施与运维路由 */
export const EXCLUDED_ROUTES = [
  '/',
  ROUTES.READYZ,
  ROUTES.LIVEZ,
  ROUTES.DOCS,
  ROUTES.DOCS_JSON,
  ROUTES.ADMIN_DOCS,
  ROUTES.ADMIN_DOCS_JSON,
  ROUTES.AUTH_DOCS,
  ROUTES.AUTH_DOCS_JSON,
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

/** Redis 连接常量 */
export const REDIS_MAX_RETRIES = 3;

/** 依赖注入令牌 */
export const INJECTION_TOKENS = {
  REDIS_CLIENT: 'REDIS_CLIENT',
  THROTTLER_STORAGE: 'THROTTLER_STORAGE',
  MAIL_TRANSPORTER: 'MAIL_TRANSPORTER',
} as const;

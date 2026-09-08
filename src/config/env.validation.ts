import { z } from 'zod';
import { APP_ENV_VALUES, PATHS } from '@/common/constants/app.constants';
import { DEFAULT_TIMEZONE, isTimezoneValid } from '@/config/timezone';

/** Laravel FILTER_VALIDATE_BOOLEAN 语义的布尔解析：'true'/'1'/'on'/'yes' → true，其余（含空串）→ false */
function envBoolean(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === undefined) return defaultValue;
      return ['true', '1', 'on', 'yes'].includes(String(value).toLowerCase());
    }, z.boolean())
    .default(defaultValue);
}

const envSchema = z.object({
  // Laravel 风格：local/testing/production（生产必须为 production）
  APP_ENV: z
    .enum([APP_ENV_VALUES.LOCAL, APP_ENV_VALUES.TESTING, APP_ENV_VALUES.PRODUCTION])
    .default(APP_ENV_VALUES.LOCAL),
  // 类似 Laravel APP_DEBUG：为 true 时异常响应附带 exception/trace 调试信息（生产必须显式设为 false）
  APP_DEBUG: envBoolean(false),
  APP_TIMEZONE: z.string().default(DEFAULT_TIMEZONE).refine(isTimezoneValid, { message: '无效的 IANA 时区名称' }),
  PORT: z.coerce.number().default(4300),
  APP_URL: z.url().default('http://localhost:4300'),
  // Laravel 风格：DB_ 前缀（config/database.php 默认读取 DB_URL）
  // 核心连接 URLs
  DB_URL: z.url(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  MAIL_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM_ADDRESS: z.string().min(1).default('no-reply@nestforge.dev'),
  MAIL_FROM_NAME: z.string().default('NestForge'),

  BETTER_AUTH_SECRET: z.string().min(16).default('nestforge-better-auth-secret-key-32-chars!'),
  BETTER_AUTH_URL: z.string().default('http://localhost:4300'),

  /** @deprecated 遗留 JWT 配置，已由 BETTER_AUTH_SECRET 统一替代 */
  JWT_ACCESS_SECRET: z.string().min(16).optional(),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),

  BULL_BOARD_USER: z.string().optional(),
  BULL_BOARD_PASSWORD: z.string().optional(),
  LOG_VIEWER_USER: z.string().optional(),
  LOG_VIEWER_PASSWORD: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  THROTTLE_TTL: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(100),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default(`./${PATHS.STORAGE_UPLOADS}`),
  STORAGE_S3_URL: z.string().optional(),
  UPLOAD_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  UPLOAD_ALLOWED_MIME_TYPES: z.string().default('image/png,image/jpeg,image/webp'),
  UPLOAD_ALLOWED_EXTENSIONS: z.string().default('.png,.jpg,.jpeg,.webp'),
  // 是否在主进程中内嵌运行 Worker（处理队列与定时任务）。默认 false（主进程仅提供 HTTP）
  WORKER_EMBEDDED: envBoolean(false),
  // 是否启用 BullMQ 队列异步处理媒体转码与缩略图衍生。默认 true
  MEDIA_QUEUE_ENABLED: envBoolean(true),
  // 是否挂载 OpenAPI Spec 与 Scalar 接口文档。默认 true（生产环境若需屏蔽文档暴露可显式设为 false）
  SWAGGER_ENABLED: envBoolean(true),
  // 实时广播驱动模式：local (内嵌 Socket.IO/SSE) 或 pusher (对接 Soketi/Pusher 独立集群)
  BROADCAST_DRIVER: z.enum(['local', 'pusher']).default('local'),
  // 统一实时长连接 DSN (例如: pusher://key:secret@127.0.0.1:6001/appId?cluster=mt1&useTls=false)
  REALTIME_URL: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
}

import { z } from 'zod';

import { APP_ENV_VALUES, isTruthyEnv, PATHS } from '@/common/constants/app.constants';
import { DEFAULT_TIMEZONE, isTimezoneValid } from '@/config/timezone';

/** Laravel FILTER_VALIDATE_BOOLEAN 语义的布尔解析：'true'/'1'/'on'/'yes' → true，其余（含空串）→ false */
function envBoolean(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === undefined) return defaultValue;
      return isTruthyEnv(value);
    }, z.boolean())
    .default(defaultValue);
}

/** 微信支付凭证是否齐全：决定 WEPAY_DRIVER 的自动推导结果（对齐 SEARCH_DRIVER 范式） */
function hasWepayCredentials(data: {
  WEPAY_APPID?: string;
  WEPAY_MCHID?: string;
  WEPAY_SERIAL_NO?: string;
  WEPAY_APIV3_KEY?: string;
  WEPAY_PRIVATE_KEY?: string;
  WEPAY_PRIVATE_KEY_PATH?: string;
}): boolean {
  return Boolean(
    data.WEPAY_APPID &&
    data.WEPAY_MCHID &&
    data.WEPAY_SERIAL_NO &&
    data.WEPAY_APIV3_KEY &&
    (data.WEPAY_PRIVATE_KEY || data.WEPAY_PRIVATE_KEY_PATH),
  );
}

/** 微信小程序凭证是否齐全：决定 MINIPROGRAM_DRIVER 的自动推导结果（对齐 SEARCH_DRIVER 范式） */
function hasMiniprogramCredentials(data: { MINIPROGRAM_APPID?: string; MINIPROGRAM_APPSECRET?: string }): boolean {
  return Boolean(data.MINIPROGRAM_APPID && data.MINIPROGRAM_APPSECRET);
}

export const envSchema = z
  .object({
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
    /**
     * 框架内置 Cookie 支持的签名密钥（≥32 字符）。
     *
     * 未配置时 `NestFactory.create` 不开启内置 Cookie 能力（`setCookie(..., { signed: true })` /
     * `@SignedCookies()` 不可用）；配置后由主进程在引导阶段读取 `process.env` 直接注入。
     */
    COOKIE_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.string().optional(),
    /**
     * 额外信任的浏览器来源（逗号分隔，`scheme://host[:port]`），供内置跨站请求防护（CSRF）放行跨域写请求。
     *
     * 同源请求与 http(s) 服务端调用无需配置；独立域名的前端（SPA）需在此列出自身来源。
     * APP_URL / BETTER_AUTH_URL / PASSKEY_ORIGIN 会自动纳入信任列表。
     */
    TRUSTED_ORIGINS: z.string().optional(),
    PASSKEY_RP_ID: z.string().optional(),
    PASSKEY_ORIGIN: z.string().optional(),

    /** @deprecated 遗留 JWT 配置，已由 BETTER_AUTH_SECRET 统一替代 */
    JWT_ACCESS_SECRET: z.string().min(16).optional(),
    JWT_REFRESH_SECRET: z.string().min(16).optional(),

    // OpenTelemetry：未配置 OTLP endpoint 时不初始化 SDK（traces/metrics 双信号经 otel-collector 转推 OpenObserve）
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    /** 追加 OTLP 导出的认证头（`key1=value1,key2=value2` 格式，collector 无需认证时留空） */
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    /** 服务名覆盖（默认 nestforge-api / nestforge-worker，按进程角色自动推导） */
    OTEL_SERVICE_NAME: z.string().optional(),
    /** 追踪采样器（官方标准枚举，默认 parentbased_always_on；生产建议 parentbased_traceidratio） */
    OTEL_TRACES_SAMPLER: z.string().optional(),
    /** 采样器参数（如 parentbased_traceidratio 配 0.01 即 1% 采样） */
    OTEL_TRACES_SAMPLER_ARG: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    THROTTLE_TTL: z.coerce.number().default(60),
    THROTTLE_LIMIT: z.coerce.number().default(100),
    // 限流计数后端：redis 为跨副本共享计数（默认，Redis 故障时自动降级）；memory 仅进程内计数
    THROTTLE_STORAGE: z.enum(['redis', 'memory']).default('redis'),
    /** 全局 HTTP 请求超时时间（毫秒），默认 15000ms（15 秒） */
    HTTP_TIMEOUT_MS: z.coerce.number().positive().default(15_000),
    /** 优雅停机硬超时保底时间（毫秒），默认 10000ms（10 秒） */
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    /** 优雅停机下线缓冲等待时间（毫秒），收到 SIGTERM 后等待网关/K8s 摘流，默认 0ms */
    SHUTDOWN_DRAIN_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
    // 存储驱动模式：若未配置，当存在 STORAGE_S3_URL 时自动推导为 's3'，否则默认为 'local'
    STORAGE_DRIVER: z.enum(['local', 's3']).optional(),
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
    // 实时广播驱动模式：local (内嵌 Socket.IO/SSE) 或 centrifugo (对接 Centrifugo 独立长连接集群)
    BROADCAST_DRIVER: z.enum(['local', 'centrifugo']).default('centrifugo'),
    // 统一实时长连接 DSN (例如: centrifugo://api-key:token-secret@127.0.0.1:8000/api)
    REALTIME_URL: z.string().optional(),
    // 客户端外部 Centrifugo 连接地址（可选，未配置时由 REALTIME_URL 自动推导）
    CENTRIFUGO_PUBLIC_WS_URL: z.string().optional(),
    CENTRIFUGO_PUBLIC_SSE_URL: z.string().optional(),
    // 全文搜索驱动模式：noop (空驱动/禁用) 或 meilisearch
    SEARCH_DRIVER: z.enum(['noop', 'meilisearch']).optional(),
    // 统一全文搜索 DSN (例如: meilisearch://masterKey@localhost:7700)
    SEARCH_URL: z.string().optional(),
    // 是否启用 BullMQ 队列异步处理全文搜索索引。默认 true
    SEARCH_QUEUE_ENABLED: envBoolean(true),
    // 统一动态图片处理 DSN (例如: imgproxy://key:salt@localhost:8080?publicUrl=http://localhost:8080)
    IMGPROXY_URL: z.string().optional(),
    // 统一 MQTT 5.0 物联网与工业通信 DSN (例如: mqtt://admin:password@localhost:1883?clientId=nest-api)
    MQTT_URL: z.string().optional(),
    // 是否启用工业设备模拟响应器（Simulated PLC Agent）。默认 false
    IOT_SIMULATED_DEVICE_ENABLED: envBoolean(false),
    // 工业设备接入凭证表 (格式: deviceId:secret，多个以英文逗号分隔)。留空表示禁止设备换票
    IOT_DEVICE_CREDENTIALS: z.string().default(''),
    // 设备接入 JWT 独立签名密钥 (≥32 字符，必须与 BETTER_AUTH_SECRET 域分离)。未配置时拒绝签发设备凭据
    IOT_JWT_SECRET: z.string().min(32).optional(),
    // 设备密钥校验用 HMAC 加固盐值 (Pepper，≥16 字符)
    IOT_DEVICE_PEPPER: z.string().min(16).default('nestforge-iot-device-pepper-v1'),
    // 设备接入 JWT 有效期 (秒)，默认 30 天
    IOT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 3600),

    // ── 微信支付 v3（直连商户）────────────────────────────────────────
    // 驱动模式：real (真实交易) 或 mock (本地确定性假数据)。留空时按凭证齐全度自动推导
    WEPAY_DRIVER: z.enum(['real', 'mock']).optional(),
    // 直连商户申请的公众号或移动应用 appid
    WEPAY_APPID: z.string().optional(),
    // 直连商户号
    WEPAY_MCHID: z.string().optional(),
    // 商户 API 证书序列号
    WEPAY_SERIAL_NO: z.string().optional(),
    // 商户 API 私钥（内联 PEM，支持 \n 转义）；优先级高于 WEPAY_PRIVATE_KEY_PATH
    WEPAY_PRIVATE_KEY: z.string().optional(),
    // 商户 API 私钥文件路径（相对项目根目录）
    WEPAY_PRIVATE_KEY_PATH: z.string().optional(),
    // APIv3 密钥（32 字节），用于回调与平台证书解密
    WEPAY_APIV3_KEY: z.string().optional(),
    // 微信支付公钥与公钥 ID（配置后走公钥模式，无需下载平台证书）
    WEPAY_PUBLIC_KEY: z.string().optional(),
    WEPAY_PUBLIC_KEY_ID: z.string().optional(),
    // 默认回调地址，单次下单可覆盖
    WEPAY_NOTIFY_URL: z.string().optional(),
    // 微信支付 API 基址
    WEPAY_API_BASE: z.string().default('https://api.mch.weixin.qq.com'),
    // 微信支付接口请求超时（毫秒）
    WEPAY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // ── 微信小程序服务端 API ──────────────────────────────────────────
    // 驱动模式：real (真实接口) 或 mock (本地确定性假数据)。留空时按凭证齐全度自动推导
    MINIPROGRAM_DRIVER: z.enum(['real', 'mock']).optional(),
    // 小程序 AppID
    MINIPROGRAM_APPID: z.string().optional(),
    // 小程序 AppSecret（服务端专用，严禁下发到前端）
    MINIPROGRAM_APPSECRET: z.string().optional(),
    // 小程序 API 基址
    MINIPROGRAM_API_BASE: z.string().default('https://api.weixin.qq.com'),
    // 小程序接口请求超时（毫秒）。同步轻请求，默认较支付接口更短
    MINIPROGRAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    // access_token 提前续期窗口（秒）：官方普通模式下亦提前 5 分钟更新，默认与之对齐
    MINIPROGRAM_ACCESS_TOKEN_SAFETY_WINDOW_SECONDS: z.coerce.number().int().nonnegative().default(300),
  })
  .transform((data) => ({
    ...data,
    STORAGE_DRIVER: data.STORAGE_DRIVER ?? (data.STORAGE_S3_URL ? ('s3' as const) : ('local' as const)),
    SEARCH_DRIVER: data.SEARCH_DRIVER ?? (data.SEARCH_URL ? ('meilisearch' as const) : ('noop' as const)),
    WEPAY_DRIVER: data.WEPAY_DRIVER ?? (hasWepayCredentials(data) ? ('real' as const) : ('mock' as const)),
    MINIPROGRAM_DRIVER:
      data.MINIPROGRAM_DRIVER ?? (hasMiniprogramCredentials(data) ? ('real' as const) : ('mock' as const)),
    BETTER_AUTH_URL: data.BETTER_AUTH_URL || data.APP_URL,
  }));

export type EnvConfig = z.infer<typeof envSchema>;

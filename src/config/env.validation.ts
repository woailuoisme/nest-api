import { z } from 'zod';

import {
  APP_ENV_VALUES,
  appName,
  DEFAULT_DB_URL,
  DEV_ONLY_AUTH_SECRET,
  DEV_ONLY_IOT_PEPPER,
  isTruthyEnv,
  PATHS,
} from '@/common/constants/app.constants';
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

/** 微信支付凭证是否齐全：决定 WEPAY_DRIVER 的自动推导结果（对齐 SCOUT_DRIVER 范式） */
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

/** 微信小程序凭证是否齐全：决定 MINIPROGRAM_DRIVER 的自动推导结果（对齐 SCOUT_DRIVER 范式） */
function hasMiniprogramCredentials(data: { MINIPROGRAM_APPID?: string; MINIPROGRAM_APPSECRET?: string }): boolean {
  return Boolean(data.MINIPROGRAM_APPID && data.MINIPROGRAM_APPSECRET);
}

/**
 * 短信通道缺失的必填项（空数组表示可启动）。
 *
 * - `aliyun`：显式选择即视为已启用该通道，四项凭证必须同时就位；
 * - `smsbao`：默认通道，完全未配置视为「短信登录未启用」照常启动（否则新克隆与 CI 无法引导）；
 *   但只配置一半属误配置，必须在启动期失败，而不是等用户点「发送验证码」时才 500。
 */
function missingSmsCredentials(data: {
  SMS_PROVIDER: 'smsbao' | 'aliyun';
  SMSBAO_USER?: string;
  SMSBAO_PASSWORD?: string;
  ALIYUN_SMS_ACCESS_KEY_ID?: string;
  ALIYUN_SMS_ACCESS_KEY_SECRET?: string;
  ALIYUN_SMS_SIGN_NAME?: string;
  ALIYUN_SMS_TEMPLATE_CODE?: string;
}): string[] {
  if (data.SMS_PROVIDER === 'aliyun') {
    const required = [
      'ALIYUN_SMS_ACCESS_KEY_ID',
      'ALIYUN_SMS_ACCESS_KEY_SECRET',
      'ALIYUN_SMS_SIGN_NAME',
      'ALIYUN_SMS_TEMPLATE_CODE',
    ] as const;
    return required.filter((key) => !data[key]);
  }

  const partiallyConfigured = Boolean(data.SMSBAO_USER) || Boolean(data.SMSBAO_PASSWORD);
  if (!partiallyConfigured) return [];
  return (['SMSBAO_USER', 'SMSBAO_PASSWORD'] as const).filter((key) => !data[key]);
}

/** 生产环境必须显式配置、不允许默认值兑底的 Key */
const PRODUCTION_REQUIRED_KEYS = ['DB_URL', 'BETTER_AUTH_SECRET'] as const;

/**
 * 空串视同未配置。
 *
 * `.env` 模板习惯用 `KEY=` 占位，若交给字段校验会先报格式错（如 Invalid URL），
 * 再叠加一条「生产必须显式配置」的重复报错。归一为 undefined 后，单个键只报一条事实。
 */
function emptyAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

/**
 * 已更名/删除的历史 env 键的新去向。
 *
 * Zod 默认丢弃未知键，旧键会静默失效并翻转行为（如 `STORAGE_DRIVER=local` 被忽略后按 S3 推导），
 * 因此在 schema 中声明为「必须不存在」的哨兵字段（见下方 `RETIRED` 字段）。
 */
const RETIRED_STORAGE_DRIVER = 'STORAGE_DRIVER 已不再生效，请改用 FILESYSTEM_DISK';
const RETIRED_SEARCH_DRIVER = 'SEARCH_DRIVER 已不再生效，请改用 SCOUT_DRIVER';
const RETIRED_BROADCAST_DRIVER = 'BROADCAST_DRIVER 已删除，实时广播固定读取 REALTIME_URL';

export const envSchema = z
  .object({
    // 应用名（品牌唯一来源）：日志 / OTel / 邮件 / 短信 / 2FA 发行方均从此推导
    APP_NAME: emptyAsUndefined(z.string().min(1).default(appName())),
    // Laravel 风格：local/testing/production（生产必须为 production）
    APP_ENV: z
      .enum([APP_ENV_VALUES.LOCAL, APP_ENV_VALUES.TESTING, APP_ENV_VALUES.PRODUCTION])
      .default(APP_ENV_VALUES.LOCAL),
    // 类似 Laravel APP_DEBUG：为 true 时异常响应附带 exception/trace 调试信息（生产必须显式设为 false）
    APP_DEBUG: envBoolean(false),
    /** 日志级别（pino）：trace | debug | info | warn | error | fatal | silent，默认 info */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    APP_TIMEZONE: z.string().default(DEFAULT_TIMEZONE).refine(isTimezoneValid, { message: '无效的 IANA 时区名称' }),
    PORT: z.coerce.number().default(4300),
    APP_URL: z.url().default('http://localhost:4300'),
    /**
     * 反向代理信任策略（Fastify `trustProxy`）：`false`（默认）/ `true`（仅非生产）/ CIDR 列表。
     *
     * 默认不信任：`req.ip` 是限流与幂等作用域的输入，无条件信任 `X-Forwarded-For`
     * 会让客户端通过伪造该头绕过按 IP 限流。生产环境使用 `true` 会在引导期直接报错，
     * 请填网关所在 CIDR（如 `172.16.0.0/12`）。按跳数信任不受支持。
     */
    TRUST_PROXY: z.string().default('false'),
    // Laravel 风格：DB_URL 是唯一连接事实源（config/database.php 亦读取 DB_URL）
    // 非生产环境回退本地默认值；生产环境必须显式配置（见下方 superRefine）
    DB_URL: emptyAsUndefined(z.url().optional()),

    REDIS_URL: z.string().default('redis://localhost:6379'),

    MAIL_URL: z.string().default('smtp://localhost:1025'),
    // 默认值仅为 RFC 2606 保留占位域：不得默认为任何真实域名，否则会以未授权域名发信（SPF/DKIM 不通过）
    MAIL_FROM_ADDRESS: z.string().min(1).default('no-reply@example.com'),
    /** 发件人显示名：未配置时跟随 APP_NAME（在下方 transform 中推导，不预先固化） */
    MAIL_FROM_NAME: z.string().optional(),

    // ── 短信通道（手机号 OTP）──────────────────────────────────────
    /** 短信服务商：smsbao（默认）| aliyun */
    SMS_PROVIDER: z.enum(['smsbao', 'aliyun']).default('smsbao'),
    SMSBAO_USER: z.string().optional(),
    SMSBAO_PASSWORD: z.string().optional(),
    /** SMSBao 短信正文模板，{code} 为验证码占位符 */
    SMSBAO_CONTENT: z.string().optional(),
    ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
    ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
    ALIYUN_SMS_SIGN_NAME: z.string().optional(),
    ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
    /** 单次短信发送超时（毫秒），默认 5000，上限 30000；防止网关异常拖住登录链路 */
    SMS_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(5000),

    // Better Auth 签名密钥：无内置默认值，生产环境必须显式配置（见下方 superRefine）
    BETTER_AUTH_SECRET: emptyAsUndefined(z.string().min(16).optional()),
    /**
     * 框架内置 Cookie 支持的签名密钥（≥32 字符）。
     *
     * 未配置时 `NestFactory.create` 不开启内置 Cookie 能力（`setCookie(..., { signed: true })` /
     * `@SignedCookies()` 不可用）；配置后由主进程在引导阶段读取 `process.env` 直接注入。
     */
    COOKIE_SECRET: emptyAsUndefined(z.string().min(32).optional()),
    BETTER_AUTH_URL: z.string().optional(),
    /**
     * 额外信任的浏览器来源（逗号分隔，`scheme://host[:port]`），供内置跨站请求防护（CSRF）放行跨域写请求。
     *
     * 同源请求与 http(s) 服务端调用无需配置；独立域名的前端（SPA）需在此列出自身来源。
     * APP_URL / BETTER_AUTH_URL 会自动纳入信任列表。
     */
    TRUSTED_ORIGINS: z.string().optional(),

    /** @deprecated 遗留 JWT 配置，已由 BETTER_AUTH_SECRET 统一替代 */
    JWT_ACCESS_SECRET: emptyAsUndefined(z.string().min(16).optional()),
    JWT_REFRESH_SECRET: emptyAsUndefined(z.string().min(16).optional()),

    // OpenTelemetry：未配置 OTLP endpoint 时不初始化 SDK（traces/metrics 双信号经 otel-collector 转推 OpenObserve）
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    /** 追加 OTLP 导出的认证头（`key1=value1,key2=value2` 格式，collector 无需认证时留空） */
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    /** 服务名覆盖（默认 `<APP_NAME>-api` / `<APP_NAME>-worker`，按进程角色自动推导） */
    OTEL_SERVICE_NAME: z.string().optional(),
    /** 追踪采样器（官方标准枚举，默认 parentbased_always_on；生产建议 parentbased_traceidratio） */
    OTEL_TRACES_SAMPLER: z.string().optional(),
    /** 采样器参数（如 parentbased_traceidratio 配 0.01 即 1% 采样） */
    OTEL_TRACES_SAMPLER_ARG: z.string().optional(),
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
    // 存储驱动（Laravel FILESYSTEM_DISK）：未配置时，存在 STORAGE_S3_URL 则推导为 's3'，否则 'local'
    FILESYSTEM_DISK: emptyAsUndefined(z.enum(['local', 's3']).optional()),
    STORAGE_LOCAL_ROOT: z.string().default(`./${PATHS.STORAGE_UPLOADS}`),
    STORAGE_S3_URL: z.string().optional(),
    UPLOAD_MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
    UPLOAD_ALLOWED_MIME_TYPES: z.string().default('image/png,image/jpeg,image/webp'),
    UPLOAD_ALLOWED_EXTENSIONS: z.string().default('.png,.jpg,.jpeg,.webp'),
    // 是否启用 BullMQ 队列异步处理媒体转码与缩略图衍生。默认 true
    MEDIA_QUEUE_ENABLED: envBoolean(true),
    // 是否挂载 OpenAPI Spec 与 Scalar 接口文档。默认 true（生产环境若需屏蔽文档暴露可显式设为 false）
    SWAGGER_ENABLED: envBoolean(true),
    // 实时长连接统一 DSN (例如: centrifugo://api-key:token-secret@127.0.0.1:8000/api)
    // 未配置时广播为空操作（no-op）且就绪探针报 down；无进程内 local 广播驱动
    REALTIME_URL: z.string().optional(),
    // 客户端外部 Centrifugo 连接地址（可选，未配置时由 REALTIME_URL 自动推导）
    CENTRIFUGO_PUBLIC_WS_URL: z.string().optional(),
    CENTRIFUGO_PUBLIC_SSE_URL: z.string().optional(),
    // Centrifugo Proxy 回调共享密钥（≥16 字符）：配置后后端强制校验该头，拒绝非网关来源。
    // 需与网关侧静态头（CENTRIFUGO_PROXY_STATIC_HTTP_HEADERS）成对配置；未配置时端点不校验（仅本地开发可接受）。
    CENTRIFUGO_PROXY_SECRET: emptyAsUndefined(z.string().min(16).optional()),
    // 全文搜索驱动（Laravel Scout SCOUT_DRIVER）：noop (空驱动/禁用) 或 meilisearch
    SCOUT_DRIVER: emptyAsUndefined(z.enum(['noop', 'meilisearch']).optional()),
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
    // 设备租户归属表 (格式: deviceId:tenantId，多个以英文逗号分隔)。租户由服务端注册表决定，不接受调用方自报
    IOT_DEVICE_TENANTS: z.string().default(''),
    // 设备接入 JWT 独立签名密钥 (≥32 字符，必须与 BETTER_AUTH_SECRET 域分离)。未配置时拒绝签发设备凭据
    IOT_JWT_SECRET: emptyAsUndefined(z.string().min(32).optional()),
    // 设备密钥校验用 HMAC 加固盐值 (Pepper，≥16 字符)。生产环境禁止使用公开默认值
    IOT_DEVICE_PEPPER: z.string().min(16).default(DEV_ONLY_IOT_PEPPER),
    // 设备接入 JWT 有效期 (秒)，默认 30 天
    IOT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 3600),

    // ── 微信支付 v3（直连商户）────────────────────────────────────────
    // 驱动模式：real (真实交易) 或 mock (本地确定性假数据)。留空时按凭证齐全度自动推导
    WEPAY_DRIVER: emptyAsUndefined(z.enum(['real', 'mock']).optional()),
    /**
     * 生产环境允许 mock 驱动的显式退让开关（默认 false）。
     *
     * 缺凭证自动降级 mock 时，生产环境必须显式声明「已知支付为假」才能启动，
     * 避免漏配一个 env 就静默上线：真实回调会全部验签失败、下单只产生假数据。
     * 接入真实支付后应删除该开关。
     */
    WEPAY_ALLOW_MOCK: envBoolean(false),
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
    // 小程序驱动：目前未接入业务登录链路（仅健康检查引用），故不设生产 mock 拦截；
    // 一旦接入 code2session 登录，必须对称补上 MINIPROGRAM_ALLOW_MOCK 守卫，否则 mock 会返回伪造 openid。
    MINIPROGRAM_DRIVER: emptyAsUndefined(z.enum(['real', 'mock']).optional()),
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

    // ── 历史键哨兵：显式声明为「必须不存在」，命中即启动失败 ──
    // （Zod 默认丢弃未知键，旧键会静默失效并翻转行为，故不能靠「不声明」来处理）
    STORAGE_DRIVER: z.undefined({ error: RETIRED_STORAGE_DRIVER }).optional(),
    SEARCH_DRIVER: z.undefined({ error: RETIRED_SEARCH_DRIVER }).optional(),
    BROADCAST_DRIVER: z.undefined({ error: RETIRED_BROADCAST_DRIVER }).optional(),
  })
  .superRefine((data, ctx) => {
    // 短信通道半配置 → 启动期直接失败，避免带着失效通道上线（首次发码才 500）
    for (const key of missingSmsCredentials(data)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${data.SMS_PROVIDER} 短信通道缺少必填配置` });
    }

    // 生产环境：核心密钥与数据库连接必须显式配置，禁止靠本地默认值静默上线
    if (data.APP_ENV !== APP_ENV_VALUES.PRODUCTION) return;
    for (const key of PRODUCTION_REQUIRED_KEYS) {
      if (!data[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `生产环境必须显式配置 ${key}（不提供默认值）` });
      }
    }

    // 「已填」不等于「安全」：旧模板曾把公开密钥预置到 .env.example，拷模板上线即中招
    if (data.BETTER_AUTH_SECRET === DEV_ONLY_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: '生产环境禁止使用公开默认密钥，请执行 just cmd jwt:secret 重新生成',
      });
    }

    // 设备胡椒同理：公开默认值会让所有部署共享同一个 pepper，摘要抗暴破能力归零
    // 仅在真正启用设备接入（配了凭证表或 MQTT）时要求，避免未用 IoT 的部署无谓报错
    const iotEnabled = Boolean(data.IOT_DEVICE_CREDENTIALS) || Boolean(data.MQTT_URL);
    if (iotEnabled && data.IOT_DEVICE_PEPPER === DEV_ONLY_IOT_PEPPER) {
      ctx.addIssue({
        code: 'custom',
        path: ['IOT_DEVICE_PEPPER'],
        message: '生产环境禁止使用公开默认胡椒值，请配置独立随机值（openssl rand -hex 32）',
      });
    }

    // 支付驱动：两类配置错误都必须在启动期拦住：
    // 1. 解析为 mock（缺凭证自动降级或显式指定）→ 真实回调全部验签失败，需 WEPAY_ALLOW_MOCK 显式退让；
    // 2. 显式 WEPAY_DRIVER=real 但凭证不齐 → 绕过推导后仍能启动，直到第一次支付才 401/解密失败。
    const resolvedWepayDriver = data.WEPAY_DRIVER ?? (hasWepayCredentials(data) ? 'real' : 'mock');
    if (resolvedWepayDriver === 'mock' && !data.WEPAY_ALLOW_MOCK) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEPAY_DRIVER'],
        message:
          '生产环境支付驱动解析为 mock（凭证不完整或显式指定）：请配置完整 WEPAY_* 凭证，或用 WEPAY_ALLOW_MOCK=true 显式退让',
      });
    }
    if (data.WEPAY_DRIVER === 'real' && !hasWepayCredentials(data)) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEPAY_DRIVER'],
        message: 'WEPAY_DRIVER=real 但 WEPAY_* 凭证不完整：下单与回调验签均会在运行期失败',
      });
    }
  })
  .transform((data) => ({
    ...data,
    DB_URL: data.DB_URL ?? DEFAULT_DB_URL,
    MAIL_FROM_NAME: data.MAIL_FROM_NAME ?? data.APP_NAME,
    FILESYSTEM_DISK: data.FILESYSTEM_DISK ?? (data.STORAGE_S3_URL ? ('s3' as const) : ('local' as const)),
    SCOUT_DRIVER: data.SCOUT_DRIVER ?? (data.SEARCH_URL ? ('meilisearch' as const) : ('noop' as const)),
    WEPAY_DRIVER: data.WEPAY_DRIVER ?? (hasWepayCredentials(data) ? ('real' as const) : ('mock' as const)),
    MINIPROGRAM_DRIVER:
      data.MINIPROGRAM_DRIVER ?? (hasMiniprogramCredentials(data) ? ('real' as const) : ('mock' as const)),
    BETTER_AUTH_URL: data.BETTER_AUTH_URL || data.APP_URL,
  }));

export type EnvConfig = z.infer<typeof envSchema>;

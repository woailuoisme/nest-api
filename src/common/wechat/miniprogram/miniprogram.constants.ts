import { HttpStatus } from '@nestjs/common';

/** 小程序 API 默认基址 */
export const MINIPROGRAM_DEFAULT_API_BASE = 'https://api.weixin.qq.com';

/** 小程序 API 请求默认超时（毫秒）：同步轻请求，较支付接口更短 */
export const MINIPROGRAM_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * access_token 提前续期窗口（秒）
 *
 * 官方在 `stable_token` 普通模式下亦会提前 5 分钟更新凭证，此处与之对齐：
 * 剩余有效期不足该窗口时视为需要续期，避免把即将失效的凭证用于业务请求。
 */
export const MINIPROGRAM_ACCESS_TOKEN_SAFETY_WINDOW_SECONDS = 300;

/** access_token 缓存最短 TTL（秒）：防止在凭证轮换边界上高频回源 */
export const MINIPROGRAM_ACCESS_TOKEN_MIN_CACHE_SECONDS = 60;

/** 应答未携带 expires_in 时采用的回退有效期（秒，官方当前为 7200） */
export const MINIPROGRAM_ACCESS_TOKEN_DEFAULT_TTL_SECONDS = 7200;

/** access_token 刷新锁 TTL（毫秒）：防止持锁实例崩溃导致死锁 */
export const MINIPROGRAM_ACCESS_TOKEN_LOCK_TTL_MS = 10_000;

/** 未抢到刷新锁时的等待时长（毫秒），随后回读缓存以复用持锁者的刷新结果 */
export const MINIPROGRAM_ACCESS_TOKEN_LOCK_WAIT_MS = 200;

/** access_token 缓存键命名空间（键尾追加 appid，支持多小程序共用一个 Redis） */
export const MINIPROGRAM_ACCESS_TOKEN_CACHE_NAMESPACE = 'wechat:miniprogram:access_token';

/** 小程序码宽度下限（官方 280px） */
export const MINIPROGRAM_QR_WIDTH_MIN = 280;

/** 小程序码宽度上限（官方 1280px） */
export const MINIPROGRAM_QR_WIDTH_MAX = 1280;

/** 不限制小程序码的 scene 最大可见字符数（官方 32） */
export const MINIPROGRAM_UNLIMITED_SCENE_MAX_LENGTH = 32;

/**
 * 不限制小程序码的 scene 合法字符集
 *
 * 官方限定为数字、大小写英文与部分特殊字符；中文与 `%` 不在集合内（`%` 不可用 URL 编码绕过），
 * 须由调用方自行编码为合法字符集（例如改用短码或索引，业务参数在数据库侧还原）。
 */
export const MINIPROGRAM_QR_SCENE_PATTERN = /^[A-Za-z0-9!#$&'()*+,/:;=?@\-._~]+$/;

/** 小程序码 / 小程序二维码 path 最大字节长度（官方 128 字节） */
export const MINIPROGRAM_QR_PATH_MAX_LENGTH = 128;

/** 内容安全单次检测文本上限（字符，官方 2500） */
export const MINIPROGRAM_MSG_SEC_CHECK_MAX_LENGTH = 2500;

/** 幂等安全的读类操作重试次数 */
export const MINIPROGRAM_READ_RETRIES = 2;

/** 读类操作重试基准间隔（毫秒），按尝试次数线性递增 */
export const MINIPROGRAM_READ_RETRY_DELAY_MS = 200;

/** 小程序接口成功错误码 */
export const MINIPROGRAM_SUCCESS_CODE = 0;

/** 小程序服务端接口路径 */
export const MINIPROGRAM_API_PATHS = {
  /** 获取稳定版接口调用凭据（与 getAccessToken 互相隔离，有效期内重复调用返回同一凭证） */
  STABLE_TOKEN: '/cgi-bin/stable_token',
  /** 登录凭证校验：js_code 换 openid / session_key */
  CODE2_SESSION: '/sns/jscode2session',
  /** 校验服务器保存的 session_key 是否有效 */
  CHECK_SESSION: '/wxa/checksession',
  /** 重置指定用户的 session_key */
  RESET_SESSION: '/wxa/resetusersessionkey',
  /** 手机号快速验证：code 换手机号 */
  PHONE_NUMBER: '/wxa/business/getuserphonenumber',
  /** 获取不限制的小程序码（数量无限制） */
  UNLIMITED_QR_CODE: '/wxa/getwxacodeunlimit',
  /** 获取小程序码（总量 10 万个） */
  QR_CODE: '/wxa/getwxacode',
  /** 获取小程序二维码（总量 10 万个） */
  PLAIN_QR_CODE: '/cgi-bin/wxaapp/createwxaqrcode',
  /** 文本内容安全识别 2.0 */
  MSG_SEC_CHECK: '/wxa/msg_sec_check',
  /** 发送订阅消息 */
  SUBSCRIBE_SEND: '/cgi-bin/message/subscribe/send',
} as const;

/** 内容安全建议值：pass 通过、review 建议人工审核、risky 违规 */
export const MINIPROGRAM_CONTENT_SUGGESTS = {
  PASS: 'pass',
  REVIEW: 'review',
  RISKY: 'risky',
} as const;

/** 内容安全命中标签枚举 → 中文描述 */
export const MINIPROGRAM_CONTENT_LABELS: Readonly<Record<number, string>> = {
  100: '正常',
  10001: '广告',
  20001: '时政',
  20002: '色情',
  20003: '辱骂',
  20006: '违法犯罪',
  20008: '欺诈',
  20012: '低俗',
  20013: '版权',
  21000: '其他',
};

/** 订阅消息跳转的小程序版本 */
export const MINIPROGRAM_SUBSCRIBE_STATES = {
  DEVELOPER: 'developer',
  TRIAL: 'trial',
  FORMAL: 'formal',
} as const;

/** 订阅消息语言类型 */
export const MINIPROGRAM_LANGS = {
  ZH_CN: 'zh_CN',
  EN_US: 'en_US',
  ZH_HK: 'zh_HK',
  ZH_TW: 'zh_TW',
} as const;

/** 登录态签名算法标识（官方目前仅支持 hmac_sha256） */
export const MINIPROGRAM_SIGN_METHOD = 'hmac_sha256';

/**
 * 小程序错误分类
 *
 * 用于判定可重试性与业务处置方式，避免调用方对错误码字符串做硬编码匹配。
 */
export type MiniprogramErrorCategory =
  /** 调用方参数或配置不符，须修代码/配置，重试无意义 */
  | 'invalid-request'
  /** 凭证、密钥、签名、登录态问题，须修配置或重新登录 */
  | 'auth'
  /** 接口权限、IP 白名单、账号能力封禁，须在公众平台开通或解封 */
  | 'permission'
  /** 内容或用户风控拦截，须拦截内容或引导用户 */
  | 'risk-control'
  /** 业务状态冲突（用户未订阅、并发下发等），须业务分支处理 */
  | 'business-state'
  /** 目标资源不存在（页面路径等） */
  | 'not-found'
  /** 频率限制，退避后可重试 */
  | 'rate-limited'
  /** 微信侧系统异常或网络故障，可原样重试 */
  | 'upstream';

/** 单个错误码的处置描述 */
export interface MiniprogramErrorDescriptor {
  /** 映射到本服务的 HTTP 状态码 */
  status: HttpStatus;
  category: MiniprogramErrorCategory;
  /** 错误文案（官方描述或本模块自定义语义） */
  description: string;
  /** 强制刷新 access_token 后重试一次即可解决（凭证失效类） */
  refreshTokenRetryable?: boolean;
  /** 可原样重试（微信侧瞬态故障或频率限制） */
  plainRetryable?: boolean;
}

/**
 * 小程序错误码映射表
 *
 * 小程序接口采用「**HTTP 200 + body 内 errcode**」的错误模型（与微信支付 v3 的 HTTP 状态码模型不同），
 * 故此处以 errcode 为键建立分类与状态映射，覆盖凭证、登录、手机号、小程序码、内容安全、订阅消息
 * 六类接口的官方错误码，并合并本模块自定义的 `MINIPROGRAM_*` 局部错误码。
 *
 * 两项用途分工明确：
 * - `category`（权威）：判定可重试性与业务处置方式；
 * - `status`（回退）：仅在没有 HTTP 应答状态可用时生效（本模块自定义错误码、网络/超时等本地失败）。
 */
export const MINIPROGRAM_ERROR_MAP: Readonly<Record<string, MiniprogramErrorDescriptor>> = {
  // ── 公共错误码 ────────────────────────────────────────────────────
  '-1': {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '微信系统繁忙',
    plainRetryable: true,
  },
  '40001': {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: 'access_token 无效或不是最新（亦可能是 AppSecret 错误）',
    refreshTokenRetryable: true,
  },
  '40002': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '不合法的凭证类型' },
  '40003': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '不合法的 OpenID' },
  '40013': { status: HttpStatus.UNAUTHORIZED, category: 'auth', description: '不合法的 AppID' },
  '40014': {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: '不合法的 access_token',
    refreshTokenRetryable: true,
  },
  '40125': { status: HttpStatus.UNAUTHORIZED, category: 'auth', description: '无效的 AppSecret' },
  '40164': {
    status: HttpStatus.FORBIDDEN,
    category: 'permission',
    description: '调用方 IP 不在白名单内，请在公众平台添加服务器出口 IP',
  },
  '41001': {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: '缺少 access_token 参数',
    refreshTokenRetryable: true,
  },
  '41002': { status: HttpStatus.UNAUTHORIZED, category: 'auth', description: '缺少 appid 参数' },
  '41004': { status: HttpStatus.UNAUTHORIZED, category: 'auth', description: '缺少 secret 参数' },
  '42001': {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: 'access_token 已过期',
    refreshTokenRetryable: true,
  },
  '43002': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '要求使用 POST 方法调用' },
  '47001': {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '请求体不是合法 JSON 或参数缺失',
  },
  '48001': {
    status: HttpStatus.FORBIDDEN,
    category: 'permission',
    description: '接口未授权，请确认小程序已获得该接口权限',
  },

  // ── 频率限制 ──────────────────────────────────────────────────────
  '45009': { status: HttpStatus.TOO_MANY_REQUESTS, category: 'rate-limited', description: '接口日调用额度超限' },
  '45011': {
    status: HttpStatus.TOO_MANY_REQUESTS,
    category: 'rate-limited',
    description: '接口分钟级调用频率超限',
    plainRetryable: true,
  },
  '44991': {
    status: HttpStatus.TOO_MANY_REQUESTS,
    category: 'rate-limited',
    description: '内容安全接口分钟级频率超限',
    plainRetryable: true,
  },

  // ── 登录与登录态 ──────────────────────────────────────────────────
  '40029': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: 'code 无效（已使用或已过期）' },
  '40226': {
    status: HttpStatus.FORBIDDEN,
    category: 'risk-control',
    description: '高风险等级用户，小程序登录被拦截',
  },
  '87007': { status: HttpStatus.BAD_REQUEST, category: 'business-state', description: 'session_key 不存在或已过期' },
  '87008': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '不合法的 sig_method' },
  '87009': { status: HttpStatus.UNAUTHORIZED, category: 'auth', description: '登录态签名无效' },

  // ── 小程序码 / 小程序二维码 ───────────────────────────────────────
  '40097': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '参数错误' },
  '40129': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: 'scene 不合法或场景值错误' },
  '40169': {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: 'scene 长度不合法（最大 32 个可见字符）',
  },
  '41030': {
    status: HttpStatus.NOT_FOUND,
    category: 'not-found',
    description: 'page 路径不正确：根路径前不能加 /、不能携带参数、须在现网版本中存在',
  },
  '85096': {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '不允许配置系统保留字段 scancode_time',
  },

  // ── 内容安全 ──────────────────────────────────────────────────────
  '43104': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: 'appid 与 openid 不匹配' },
  '44002': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: 'POST 请求体为空' },
  '61010': {
    status: HttpStatus.BAD_REQUEST,
    category: 'business-state',
    description: '用户访问记录超时（用户需在近两小时内访问过小程序）',
  },
  '87014': {
    status: HttpStatus.BAD_REQUEST,
    category: 'risk-control',
    description: '内容含有违法违规内容（内容安全 1.0 语义；2.0 起改用 result.suggest 判定）',
  },

  // ── 订阅消息 ──────────────────────────────────────────────────────
  '40037': { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '不合法的 template_id' },
  '43101': {
    status: HttpStatus.CONFLICT,
    category: 'business-state',
    description: '用户未订阅该消息或一次性订阅次数已用完',
  },
  '43107': { status: HttpStatus.FORBIDDEN, category: 'permission', description: '订阅消息能力被封禁' },
  '43108': { status: HttpStatus.CONFLICT, category: 'business-state', description: '并发下发消息给同一用户' },
  '45168': { status: HttpStatus.BAD_REQUEST, category: 'risk-control', description: '下发消息命中敏感词' },
  '47003': {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '订阅消息 data 结构或取值不符合模板规则',
  },

  // ── 接口管理 ──────────────────────────────────────────────────────
  '89503': {
    status: HttpStatus.FORBIDDEN,
    category: 'permission',
    description: '此次调用需要管理员确认，请耐心等候',
  },
  '89506': {
    status: HttpStatus.FORBIDDEN,
    category: 'permission',
    description: '该 IP 调用请求已被管理员拒绝，请 24 小时后再试',
  },
  '89507': {
    status: HttpStatus.FORBIDDEN,
    category: 'permission',
    description: '该 IP 调用请求已被管理员拒绝，请 1 小时后再试',
  },

  // ── 本模块自定义：网络与应答 ──────────────────────────────────────
  MINIPROGRAM_TIMEOUT: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    category: 'upstream',
    description: '小程序接口请求超时',
    plainRetryable: true,
  },
  MINIPROGRAM_NETWORK_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '小程序接口网络异常',
    plainRetryable: true,
  },
  MINIPROGRAM_HTTP_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '小程序接口返回未预期的错误应答',
    plainRetryable: true,
  },
  MINIPROGRAM_INVALID_RESPONSE: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '小程序应答体缺失必需字段或不是合法 JSON',
  },
  MINIPROGRAM_BINARY_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '小程序码接口返回了无法解析的错误应答',
  },

  // ── 本模块自定义：凭证与配置 ──────────────────────────────────────
  MINIPROGRAM_CONFIG_INCOMPLETE: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'invalid-request',
    description: '小程序凭证不完整：请配置 MINIPROGRAM_APPID 与 MINIPROGRAM_APPSECRET',
  },
  MINIPROGRAM_TOKEN_MISSING: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '获取 access_token 的应答中缺少 access_token 字段',
  },
  MINIPROGRAM_TOKEN_REFRESH_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'auth',
    description: '强制刷新 access_token 失败',
  },

  // ── 本模块自定义：入参约束 ────────────────────────────────────────
  MINIPROGRAM_JS_CODE_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少登录凭证 jsCode',
  },
  MINIPROGRAM_OPENID_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少用户 openid',
  },
  MINIPROGRAM_SESSION_KEY_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少 session_key（需先完成登录换取）',
  },
  MINIPROGRAM_SESSION_KEY_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: 'session_key 已失效，需用户重新登录换取',
  },
  MINIPROGRAM_SUBSCRIBE_INPUT_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '订阅消息入参不合法：touser / templateId / data 均为必填',
  },
  MINIPROGRAM_QR_SCENE_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少 scene 参数',
  },
  MINIPROGRAM_QR_SCENE_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: 'scene 超过 32 个可见字符上限，请改用短编码或索引',
  },
  MINIPROGRAM_QR_SCENE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description:
      'scene 含不合法字符：仅支持数字、大小写英文与部分特殊字符，中文与 % 需改用其他编码方式（如短码或索引）',
  },
  MINIPROGRAM_QR_PATH_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少小程序页面路径 path',
  },
  MINIPROGRAM_QR_PATH_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: 'path 不合法：根路径前不要加 /，且不能携带参数（参数请放入 scene）',
  },
  MINIPROGRAM_QR_WIDTH_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '小程序码宽度必须在 280~1280 之间',
  },
  MINIPROGRAM_CONTENT_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少待检测的文本内容',
  },
  MINIPROGRAM_CONTENT_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '待检测文本超过 2500 字上限',
  },
  MINIPROGRAM_DECRYPT_FAILED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'auth',
    description: '用户数据解密失败（session_key 或 iv 不匹配）',
  },
  MINIPROGRAM_MOCK_ONLY: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '仅 mock 驱动支持该能力',
  },
};

/** 错误码未收录、且 HTTP 应答无可用状态时的兜底状态 */
export const MINIPROGRAM_DEFAULT_ERROR_STATUS = HttpStatus.BAD_GATEWAY;

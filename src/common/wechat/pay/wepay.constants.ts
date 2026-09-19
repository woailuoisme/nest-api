import { HttpStatus } from '@nestjs/common';

/** 微信支付 v3 签名算法标识 */
export const WEPAY_SIGN_TYPE = 'WECHATPAY2-SHA256-RSA2048';

/** 微信支付 API 默认基址 */
export const WEPAY_DEFAULT_API_BASE = 'https://api.mch.weixin.qq.com';

/** 微信支付请求默认超时（毫秒） */
export const WEPAY_DEFAULT_TIMEOUT_MS = 15_000;

/** 回调报文时间戳容差（秒）：微信官方建议 5 分钟，超出视为重放攻击 */
export const WEPAY_NOTIFY_TOLERANCE_SECONDS = 300;

/** 平台证书缓存有效期（毫秒）：到期后惰性重新拉取 */
export const WEPAY_PLATFORM_CERT_TTL_MS = 12 * 60 * 60 * 1000;

/** 读操作重试次数（仅幂等安全的查询类接口，写操作严禁重试） */
export const WEPAY_READ_RETRIES = 2;

/** 读操作重试基准间隔（毫秒），按尝试次数线性递增 */
export const WEPAY_READ_RETRY_DELAY_MS = 200;

/** 微信支付回调事件类型 */
export const WEPAY_EVENT_TYPES = {
  TRANSACTION_SUCCESS: 'TRANSACTION.SUCCESS',
  REFUND_SUCCESS: 'REFUND.SUCCESS',
  REFUND_ABNORMAL: 'REFUND.ABNORMAL',
  REFUND_CLOSED: 'REFUND.CLOSED',
} as const;

/** 微信支付 v3 接口路径 */
export const WEPAY_API_PATHS = {
  NATIVE: '/v3/pay/transactions/native',
  JSAPI: '/v3/pay/transactions/jsapi',
  H5: '/v3/pay/transactions/h5',
  APP: '/v3/pay/transactions/app',
  TRANSACTION_BY_OUT_TRADE_NO: (outTradeNo: string) => `/v3/pay/transactions/out-trade-no/${outTradeNo}`,
  TRANSACTION_BY_ID: (transactionId: string) => `/v3/pay/transactions/id/${transactionId}`,
  CLOSE: (outTradeNo: string) => `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`,
  REFUND: '/v3/refund/domestic/refunds',
  REFUND_BY_OUT_REFUND_NO: (outRefundNo: string) => `/v3/refund/domestic/refunds/${outRefundNo}`,
  TRADE_BILL: '/v3/bill/tradebill',
  FUND_FLOW_BILL: '/v3/bill/fundflowbill',
  CERTIFICATES: '/v3/certificates',
} as const;

/** 微信支付回调与应答签名相关请求头（统一小写，Fastify 已归一化） */
export const WEPAY_HEADERS = {
  TIMESTAMP: 'wechatpay-timestamp',
  NONCE: 'wechatpay-nonce',
  SIGNATURE: 'wechatpay-signature',
  SERIAL: 'wechatpay-serial',
  REQUEST_ID: 'request-id',
} as const;

/** 平台证书序列号缺失时的强制刷新最小间隔（毫秒）：防止伪造 serial 触发证书拉取的放大攻击 */
export const WEPAY_PLATFORM_CERT_FORCE_REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * 账单生成中的退避重试次数
 *
 * 微信账单在 D+1 10:00 起生成，偶有延迟；此处的短退避用于覆盖「刚过生成时刻但尚未落盘」的窗口，
 * 跨天等待由业务侧定时任务负责，绝不在请求链路里长时间阻塞。
 */
export const WEPAY_BILL_READY_RETRIES = 3;

/** 账单生成中的退避重试固定间隔（毫秒） */
export const WEPAY_BILL_READY_RETRY_DELAY_MS = 10_000;

/** 账单就绪时刻（北京时间 D+1 10:00，即 UTC D+1 02:00）在当日的小时数 */
export const WEPAY_BILL_READY_UTC_HOUR = 2;

/** 账单可下载的最大回溯天数（宽松取 93 天，避免比微信「三个月」窗口更严而误拦合法请求） */
export const WEPAY_BILL_MAX_AGE_DAYS = 93;

/**
 * 微信支付错误分类
 *
 * 用于判定可重试性与业务处置方式，避免调用方对错误码字符串做硬编码匹配。
 */
export type WepayErrorCategory =
  /** 调用方参数或配置不符，须修代码/配置，重试无意义 */
  | 'invalid-request'
  /** 签名、证书或商户权限问题，须修配置或申请权限 */
  | 'auth'
  /** 订单/交易/账单状态冲突，须业务分支处理 */
  | 'business-state'
  /** 商户或用户账户侧问题（余额不足、账号异常），须人工介入 */
  | 'account'
  /** 目标资源不存在 */
  | 'not-found'
  /** 频率限制，退避后可重试 */
  | 'rate-limited'
  /** 微信侧系统异常，可原样重试 */
  | 'upstream';

/** 单个错误码的处置描述 */
export interface WepayErrorDescriptor {
  /** 映射到本服务的 HTTP 状态码 */
  status: HttpStatus;
  category: WepayErrorCategory;
  /** 错误文案（官方描述或本模块自定义语义） */
  description: string;
}

/**
 * 微信支付 v3 错误码映射表
 *
 * 依据官方「公共错误码」与各接口「业务错误码」整理，覆盖下单 / 查单 / 关单 / 退款 / 查退款 / 账单 / 证书，
 * 并合并本模块自定义的 `WEPAY_*` 局部错误码。两项用途分工明确：
 *
 * - `category`（权威）：判定可重试性与业务处置方式，官方码与本模块码共用同一套分类；
 * - `status`（回退）：**仅在没有微信应答状态时生效**（本模块自定义错误码、网络/超时/验签等本地失败）。
 *
 * 凡携带微信应答的错误一律采用**应答中的原始状态码** —— 官方对同一错误码在不同接口标注不同状态
 * （如 `MCH_NOT_EXISTS` 在下单为 400、在退款为 404），透传应答状态方能与官方映射 100% 一致。
 */
export const WEPAY_ERROR_MAP: Readonly<Record<string, WepayErrorDescriptor>> = {
  // ── 公共错误码（所有接口）─────────────────────────────────────────
  PARAM_ERROR: { status: HttpStatus.BAD_REQUEST, category: 'invalid-request', description: '参数错误' },
  INVALID_REQUEST: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '请求不符合 APIv3 接口规则，或符合格式但不符合业务规则',
  },
  SIGN_ERROR: {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: '验签不通过（签名错误或证书序列号有误）',
  },
  SYSTEM_ERROR: { status: HttpStatus.INTERNAL_SERVER_ERROR, category: 'upstream', description: '微信支付系统异常' },

  // ── 商户、AppID 与权限 ────────────────────────────────────────────
  APPID_MCHID_NOT_MATCH: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: 'AppID 与 mchid 不匹配',
  },
  MCH_NOT_EXISTS: { status: HttpStatus.NOT_FOUND, category: 'not-found', description: '商户号不存在' },
  APPID_NOT_EXIST: { status: HttpStatus.NOT_FOUND, category: 'not-found', description: 'AppID 不存在' },
  NO_AUTH: { status: HttpStatus.FORBIDDEN, category: 'auth', description: '商户无权限使用该功能' },
  /** 部分接口使用 NOAUTH 写法 */
  NOAUTH: { status: HttpStatus.FORBIDDEN, category: 'auth', description: '商户无权限使用该功能' },

  // ── 交易与订单状态 ────────────────────────────────────────────────
  ORDER_CLOSED: { status: HttpStatus.BAD_REQUEST, category: 'business-state', description: '订单已关闭，请重新下单' },
  ORDER_PAID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'business-state',
    description: '订单已支付，不可重复支付或关闭',
  },
  OUT_TRADE_NO_USED: {
    status: HttpStatus.FORBIDDEN,
    category: 'business-state',
    description: '商户订单号重复',
  },
  RULE_LIMIT: {
    status: HttpStatus.FORBIDDEN,
    category: 'business-state',
    description: '业务规则限制（如请求频率或风控阈值）',
  },
  TRADE_ERROR: {
    status: HttpStatus.FORBIDDEN,
    category: 'business-state',
    description: '因业务原因交易失败',
  },
  ACCOUNT_ERROR: { status: HttpStatus.FORBIDDEN, category: 'account', description: '用户账号异常' },
  NOT_ENOUGH: { status: HttpStatus.FORBIDDEN, category: 'account', description: '余额不足' },
  USER_ACCOUNT_ABNORMAL: {
    status: HttpStatus.FORBIDDEN,
    category: 'account',
    description: '退款请求失败（用户账户异常，需另行处理）',
  },
  CONTRACT_NOT_EXIST: {
    status: HttpStatus.FORBIDDEN,
    category: 'not-found',
    description: '签约协议不存在或已解约',
  },

  // ── 资源不存在 ────────────────────────────────────────────────────
  RESOURCE_NOT_EXISTS: {
    status: HttpStatus.NOT_FOUND,
    category: 'not-found',
    description: '目标资源不存在（订单号或退款单号有误，或订单未支付）',
  },
  ORDER_NOT_EXIST: { status: HttpStatus.NOT_FOUND, category: 'not-found', description: '订单不存在' },
  USER_NOT_EXISTS: { status: HttpStatus.NOT_FOUND, category: 'not-found', description: 'OpenID 不正确' },

  // ── 账单下载 ──────────────────────────────────────────────────────
  NO_STATEMENT_EXIST: {
    status: HttpStatus.BAD_REQUEST,
    category: 'not-found',
    description: '账单文件不存在（指定日期无资金变动）',
  },
  STATEMENT_CREATING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'business-state',
    description: '账单生成中（T+1 上午 10 点后可重新下载）',
  },

  // ── 频率限制 ──────────────────────────────────────────────────────
  FREQUENCY_LIMITED: { status: HttpStatus.TOO_MANY_REQUESTS, category: 'rate-limited', description: '请求频率超限' },

  // ── 本模块自定义：请求与网络 ──────────────────────────────────────
  WEPAY_TIMEOUT: { status: HttpStatus.GATEWAY_TIMEOUT, category: 'upstream', description: '微信支付接口请求超时' },
  WEPAY_NETWORK_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '微信支付接口网络异常',
  },
  WEPAY_HTTP_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '微信支付接口返回未预期的错误应答',
  },
  WEPAY_INVALID_RESPONSE: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '微信支付应答体缺失必需字段或不是合法 JSON',
  },

  // ── 本模块自定义：验签、证书与回调 ────────────────────────────────
  WEPAY_RESPONSE_SIGNATURE_INVALID: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'auth',
    description: '微信支付应答验签失败',
  },
  WEPAY_CERTIFICATE_UNRESOLVED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'auth',
    description: '无法解析微信支付验签凭据',
  },
  WEPAY_NOTIFY_HEADERS_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '微信支付回调缺少签名请求头',
  },
  WEPAY_NOTIFY_TIMESTAMP_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '微信支付回调时间戳超出容差窗口（疑似重放）',
  },
  WEPAY_NOTIFY_SIGNATURE_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    category: 'auth',
    description: '微信支付回调验签失败',
  },
  WEPAY_NOTIFY_MALFORMED: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '微信支付回调报文结构不合法',
  },
  WEPAY_NOTIFY_DECRYPT_FAILED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'auth',
    description: '微信支付回调解密失败（通常为 APIv3 密钥配置错误）',
  },

  // ── 本模块自定义：配置与调用约束 ──────────────────────────────────
  WEPAY_NOTIFY_URL_MISSING: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'invalid-request',
    description: '缺少回调地址（未配置 WEPAY_NOTIFY_URL 且调用时未传入 notifyUrl）',
  },
  WEPAY_PRIVATE_KEY_MISSING: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'invalid-request',
    description: '缺少商户 API 私钥',
  },
  WEPAY_PRIVATE_KEY_UNREADABLE: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'invalid-request',
    description: '商户 API 私钥文件读取失败',
  },
  WEPAY_BILL_NOT_READY: {
    status: HttpStatus.BAD_REQUEST,
    category: 'business-state',
    description: '账单尚未生成（当日账单需次日北京时间 10 点后生成）',
  },
  WEPAY_BILL_DATE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '账单日期格式非法（应为 yyyy-MM-DD）',
  },
  WEPAY_BILL_DATE_OUT_OF_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '账单日期超出可下载范围（仅支持近三个月）',
  },
  WEPAY_BILL_HASH_MISMATCH: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: '账单文件摘要与微信下发的 hash_value 不一致（文件损坏或被篡改）',
  },
  WEPAY_BILL_DECOMPRESS_FAILED: {
    status: HttpStatus.BAD_GATEWAY,
    category: 'upstream',
    description: 'GZIP 账单文件解压失败',
  },
  WEPAY_BILL_HASH_TYPE_UNSUPPORTED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    category: 'invalid-request',
    description: '微信返回了本模块不支持的账单摘要算法（官方固定为 SHA1）',
  },
  WEPAY_MOCK_ONLY: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '仅 mock 驱动支持该能力',
  },
  WEPAY_REFUND_NO_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '缺少商户退款单号 outRefundNo',
  },
  WEPAY_REFUND_TARGET_MISSING: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '退款必须提供 transactionId 或 outTradeNo 之一',
  },
  WEPAY_REFUND_AMOUNT_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '退款金额必须为正整数（单位：分）',
  },
  WEPAY_REFUND_AMOUNT_EXCEEDED: {
    status: HttpStatus.BAD_REQUEST,
    category: 'invalid-request',
    description: '退款金额不得超过订单总金额',
  },
};

/** 错误码未收录、且微信未返回可用 4xx 状态时的兜底状态 */
export const WEPAY_DEFAULT_ERROR_STATUS = HttpStatus.BAD_GATEWAY;

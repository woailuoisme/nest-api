import type {
  AppResult,
  CreateAppInput,
  CreateH5Input,
  CreateJsapiInput,
  CreateNativeInput,
  H5Result,
  JsapiResult,
  NativeResult,
  WepayDriverHealth,
  WepayDriverName,
  WepayFundFlowBillInput,
  WepayMockNotifyInput,
  WepayNotifyHeaders,
  WepayNotifyPayload,
  WepayNotifyResource,
  WepayRefundInput,
  WepayRefundResult,
  WepayTradeBillInput,
  WepayTransactionResult,
} from '../interfaces/wepay.interface';

/** mock 驱动产出的可直投回调报文（header 与 body 均已签名） */
export interface WepayMockNotifyMessage {
  headers: Record<string, string>;
  body: string;
}

/**
 * 微信支付驱动契约
 *
 * 与项目 search/ 多驱动范式对齐：real 驱动对接真实微信支付 API，
 * mock 驱动提供确定性假数据且复用完全相同的验签/解密实现。
 */
export interface IWepayDriver {
  readonly name: WepayDriverName;

  // ── 下单 ──────────────────────────────────────────────
  createNative(input: CreateNativeInput): Promise<NativeResult>;
  createJsapi(input: CreateJsapiInput): Promise<JsapiResult>;
  createH5(input: CreateH5Input): Promise<H5Result>;
  createApp(input: CreateAppInput): Promise<AppResult>;

  // ── 查询（幂等安全，接入重试） ───────────────────────────
  queryByOutTradeNo(outTradeNo: string): Promise<WepayTransactionResult>;
  queryByTransactionId(transactionId: string): Promise<WepayTransactionResult>;
  queryRefund(outRefundNo: string): Promise<WepayRefundResult>;
  downloadTradeBill(input: WepayTradeBillInput): Promise<string>;
  downloadFundFlowBill(input: WepayFundFlowBillInput): Promise<string>;

  // ── 写操作（严禁重试） ──────────────────────────────────
  close(outTradeNo: string): Promise<void>;
  refund(input: WepayRefundInput): Promise<WepayRefundResult>;

  // ── 回调支撑 ───────────────────────────────────────────
  /** 仅校验签名与时间戳新鲜度，不解密（平台证书需异步解析，故为 Promise） */
  verifyNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<void>;
  /** 解密 resource 密文，返回解密后的业务资源原文 */
  decryptNotifyResource(resource: WepayNotifyResource): Record<string, unknown>;
  /** 验签并解密，返回可信的业务载荷 */
  verifyAndDecryptNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<WepayNotifyPayload>;

  /** 本地校验健康状态（不发起外部请求） */
  checkHealth(): Promise<WepayDriverHealth>;

  /** 仅 mock 驱动实现：产出签名合法的回调报文，供本地端到端联调 */
  issueNotify?(input: WepayMockNotifyInput): WepayMockNotifyMessage;
}

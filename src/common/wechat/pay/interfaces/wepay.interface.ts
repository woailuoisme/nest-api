/** 驱动类型：real 走真实微信支付 API，mock 走本地确定性假数据 */
export type WepayDriverName = 'real' | 'mock';

/** 验签凭据模式：public-key 为微信支付公钥（2024 后新商户），platform-cert 为平台证书自动下载 */
export type WepayCertificateMode = 'public-key' | 'platform-cert' | 'none';

/** 交易状态 */
export type WepayTradeState = 'SUCCESS' | 'REFUND' | 'NOTPAY' | 'CLOSED' | 'REVOKED' | 'USERPAYING' | 'PAYERROR';

/** 退款状态：PROCESSING 为处理中，SUCCESS 为成功，ABNORMAL / CLOSED 均需人工介入 */
export type WepayRefundStatus = 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL';

/** 退款未成功状态：ABNORMAL 退款异常、CLOSED 退款关闭 */
export type WepayRefundFailStatus = Extract<WepayRefundStatus, 'ABNORMAL' | 'CLOSED'>;

/** 订单金额信息 */
export interface WepayAmount {
  /** 总金额，单位为分 */
  total: number;
  /** 货币类型，默认 CNY */
  currency?: string;
}

/** 单品列表信息 */
export interface WepayGoodsDetail {
  merchant_goods_id: string;
  wechatpay_goods_id?: string;
  goods_name?: string;
  quantity: number;
  unit_price: number;
}

/** 退款单品信息 */
export interface WepayRefundGoodsDetail {
  merchant_goods_id: string;
  wechatpay_goods_id?: string;
  goods_name?: string;
  unit_price: number;
  refund_quantity: number;
  refund_amount: number;
}

/** 优惠功能明细 */
export interface WepayDetail {
  cost_price?: number;
  invoice_id?: string;
  goods_detail?: WepayGoodsDetail[];
}

/** 支付者信息 */
export interface WepayPayer {
  /** 用户在直连商户 appid 下的唯一标识 */
  openid: string;
}

/** 商户门店信息 */
export interface WepayStoreInfo {
  id: string;
  name?: string;
  area_code?: string;
  address?: string;
}

/** H5 场景信息 */
export interface WepayH5Info {
  /** 场景类型，如 iOS / Android / Wap */
  type: string;
  /** 应用名称 */
  app_name: string;
  app_url?: string;
  bundle_id?: string;
  package_name?: string;
}

/** H5 支付场景描述 */
export interface WepaySceneInfoH5 {
  payer_client_ip: string;
  device_id?: string;
  store_info?: WepayStoreInfo;
  h5_info: WepayH5Info;
}

/** 下单公共入参 */
export interface WepayPrepayBaseInput {
  /** 商户订单号（6~32 字符，微信侧天然幂等键，由调用方保证唯一） */
  outTradeNo: string;
  /** 商品描述 */
  description: string;
  /** 订单金额 */
  amount: WepayAmount;
  /** 回调地址，缺省时回退 WEPAY_NOTIFY_URL */
  notifyUrl?: string;
  /** 交易结束时间，RFC3339 格式 */
  timeExpire?: string;
  /** 附加数据，回调原样返回 */
  attach?: string;
  /** 订单优惠标记 */
  goodsTag?: string;
  /** 优惠功能明细 */
  detail?: WepayDetail;
}

/** Native（扫码）下单入参 */
export interface CreateNativeInput extends WepayPrepayBaseInput {
  settleInfo?: { profit_sharing?: boolean };
}

/** JSAPI（公众号/小程序）下单入参，payer.openid 为必填 */
export interface CreateJsapiInput extends WepayPrepayBaseInput {
  payer: WepayPayer;
}

/** H5 下单入参，sceneInfo.h5_info 为必填 */
export interface CreateH5Input extends WepayPrepayBaseInput {
  sceneInfo: WepaySceneInfoH5;
}

/** App 下单入参 */
export type CreateAppInput = WepayPrepayBaseInput;

/** JSAPI 二次签名参数，供前端 WeixinJSBridge / wx.chooseWXPay 直接使用 */
export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** App 二次签名参数，供移动端 SDK 直接使用 */
export interface AppPayParams {
  appId: string;
  partnerId: string;
  prepayId: string;
  package: 'Sign=WXPay';
  nonceStr: string;
  timeStamp: string;
  sign: string;
}

/** Native 下单结果 */
export interface NativeResult {
  /** 二维码链接，由调用方决定渲染方式 */
  codeUrl: string;
}

/** H5 下单结果 */
export interface H5Result {
  h5Url: string;
}

/** JSAPI 下单结果 */
export interface JsapiResult {
  prepayId: string;
  payParams: JsapiPayParams;
}

/** App 下单结果 */
export interface AppResult {
  prepayId: string;
  payParams: AppPayParams;
}

/** 订单查询结果 */
export interface WepayTransactionResult {
  outTradeNo: string;
  transactionId?: string;
  tradeState: WepayTradeState;
  tradeStateDesc?: string;
  tradeType?: string;
  successTime?: string;
  appid: string;
  mchid: string;
  amount?: {
    total: number;
    payer_total?: number;
    currency?: string;
    payer_currency?: string;
  };
  payer?: WepayPayer;
  attach?: string;
  /** 微信原始应答体，供业务按需读取扩展字段 */
  raw: Record<string, unknown>;
}

/** 退款申请入参 */
export interface WepayRefundInput {
  /** 商户退款单号，微信侧幂等键 */
  outRefundNo: string;
  /** 与 outTradeNo 二选一 */
  transactionId?: string;
  /** 与 transactionId 二选一 */
  outTradeNo?: string;
  reason?: string;
  notifyUrl?: string;
  fundsAccount?: string;
  amount: {
    refund: number;
    total: number;
    currency?: string;
  };
  goodsDetail?: WepayRefundGoodsDetail[];
}

/** 退款结果 */
export interface WepayRefundResult {
  outRefundNo: string;
  refundId?: string;
  outTradeNo?: string;
  transactionId?: string;
  status: WepayRefundStatus;
  successTime?: string;
  amount?: {
    total: number;
    refund: number;
    payer_total?: number;
    payer_refund?: number;
    currency?: string;
  };
  /** 微信原始应答体，供业务按需读取扩展字段 */
  raw: Record<string, unknown>;
}

/** 交易账单下载入参 */
export interface WepayTradeBillInput {
  /** 账单日期，格式 yyyy-MM-dd，仅支持近三个月 */
  billDate: string;
  billType: 'ALL' | 'SUCCESS' | 'REFUND' | 'RECHARGE_REFUND';
  tarType?: 'GZIP';
}

/** 资金账单下载入参 */
export interface WepayFundFlowBillInput {
  /** 账单日期，格式 yyyy-MM-dd，仅支持近三个月 */
  billDate: string;
  accountType: 'BASIC' | 'OPERATION' | 'FEES';
  tarType?: 'GZIP';
}

/** 微信支付回调请求头 */
export interface WepayNotifyHeaders {
  timestamp?: string;
  nonce?: string;
  signature?: string;
  serial?: string;
}

/** 回调 resource 密文（微信原始字段名） */
export interface WepayNotifyResource {
  algorithm: string;
  ciphertext: string;
  associated_data?: string;
  nonce: string;
  original_type?: string;
}

/** 回调信封（微信原始字段名） */
export interface WepayNotifyEnvelope {
  id: string;
  create_time: string;
  event_type: string;
  resource_type: string;
  summary: string;
  resource: WepayNotifyResource;
}

/** 解密后的回调业务载荷（规范化驼峰字段） */
export interface WepayNotifyPayload {
  /** 回调通知 ID，微信侧唯一 */
  id: string;
  eventType: string;
  resourceType: string;
  summary: string;
  createTime: string;
  /** 解密后的业务资源原文 */
  resource: Record<string, unknown>;
}

/** mock 驱动产出回调报文的入参 */
export interface WepayMockNotifyInput {
  /** 事件类型，如 TRANSACTION.SUCCESS */
  eventType: string;
  resourceType?: string;
  summary?: string;
  /** 待加密的业务资源原文 */
  resource: Record<string, unknown>;
}

/** 驱动健康状态（仅本地校验，不发起外部请求） */
export interface WepayDriverHealth {
  status: 'up' | 'degraded';
  driver: WepayDriverName;
  message?: string;
  certificateMode?: WepayCertificateMode;
  /** 平台证书到期时间（RFC3339），公钥模式下为空 */
  certificateExpireTime?: string;
}

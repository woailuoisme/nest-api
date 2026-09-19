/**
 * 微信支付回调解密后的业务资源结构（微信原始字段名）
 *
 * 仅在回调处理链路内部使用，不对外序列化；业务侧消费的是
 * `@/common/events` 中已规范化为驼峰的领域事件载荷。
 */

/** 支付结果通知资源（TRANSACTION.SUCCESS 等事件） */
export interface WepayTransactionNotifyResource {
  appid: string;
  mchid: string;
  out_trade_no: string;
  transaction_id: string;
  trade_type: string;
  trade_state: string;
  trade_state_desc?: string;
  bank_type?: string;
  attach?: string;
  success_time?: string;
  payer?: { openid?: string };
  amount?: {
    total?: number;
    payer_total?: number;
    currency?: string;
    payer_currency?: string;
  };
}

/** 退款结果通知资源（REFUND.SUCCESS 等事件） */
export interface WepayRefundNotifyResource {
  mchid: string;
  out_trade_no: string;
  transaction_id: string;
  out_refund_no: string;
  refund_id: string;
  refund_status: string;
  success_time?: string;
  amount?: {
    total?: number;
    refund?: number;
    payer_total?: number;
    payer_refund?: number;
  };
}

/** 断言回调资源为支付结果通知结构 */
export function isTransactionNotifyResource(resource: unknown): resource is WepayTransactionNotifyResource {
  const candidate = resource as WepayTransactionNotifyResource | null;
  return Boolean(candidate?.out_trade_no && candidate?.transaction_id && candidate?.trade_state);
}

/** 断言回调资源为退款结果通知结构 */
export function isRefundNotifyResource(resource: unknown): resource is WepayRefundNotifyResource {
  const candidate = resource as WepayRefundNotifyResource | null;
  return Boolean(candidate?.out_refund_no && candidate?.refund_id && candidate?.refund_status);
}

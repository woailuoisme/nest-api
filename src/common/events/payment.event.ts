import type { WepayRefundFailStatus } from '@/common/wechat/pay/interfaces/wepay.interface';

/** 支付领域事件名 */
export const PAYMENT_EVENTS = {
  /** 已收到并解密一条可信的微信支付回调（无论业务是否处理） */
  NOTIFY_RECEIVED: 'payment.notify.received',
  /** 支付成功 */
  SUCCEEDED: 'payment.succeeded',
  /** 退款成功 */
  REFUNDED: 'payment.refunded',
  /** 退款未成功（退款异常或退款关闭），需人工介入 */
  REFUND_FAILED: 'payment.refund_failed',
} as const;

export type PaymentEventType = (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];

/** 回调已收妥事件：携带解密后的业务资源原文，供审计与排障 */
export interface PaymentNotifyReceivedEvent {
  /** 微信回调通知 ID */
  notifyId: string;
  /** 微信事件类型，如 TRANSACTION.SUCCESS */
  eventType: string;
  resourceType: string;
  summary: string;
  createTime: string;
  /** 解密后的业务资源原文 */
  resource: Record<string, unknown>;
}

/** 支付成功事件 */
export interface PaymentSucceededEvent {
  notifyId: string;
  eventType: string;
  /** 商户订单号 */
  outTradeNo: string;
  /** 微信支付订单号 */
  transactionId: string;
  amount: {
    total: number;
    payerTotal?: number;
    currency?: string;
  };
  payerOpenid?: string;
  attach?: string;
  successTime?: string;
}

/** 退款成功事件 */
export interface PaymentRefundedEvent {
  notifyId: string;
  eventType: string;
  outTradeNo: string;
  outRefundNo: string;
  refundId: string;
  transactionId: string;
  amount: {
    total: number;
    refund: number;
  };
  successTime?: string;
}

/**
 * 退款未成功事件
 *
 * ABNORMAL 表示退款异常（如银行卡已注销，需人工介入或更换退款方式）；
 * CLOSED 表示退款关闭（资金已退回商户，需重新发起）。两者均不会再有后续回调。
 */
export interface PaymentRefundFailedEvent {
  notifyId: string;
  eventType: string;
  outTradeNo: string;
  outRefundNo: string;
  refundId: string;
  transactionId: string;
  status: WepayRefundFailStatus;
  amount: {
    total: number;
    refund: number;
  };
}

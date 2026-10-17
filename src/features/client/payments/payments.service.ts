import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  PAYMENT_EVENTS,
  type PaymentRefundedEvent,
  type PaymentRefundFailedEvent,
  type PaymentSucceededEvent,
} from '@/common/events';
import { IdempotencyService } from '@/common/idempotency';
import type { WepayNotifyHeaders, WepayNotifyPayload, WepayRefundFailStatus } from '@/common/wechat/pay';
import { WEPAY_EVENT_TYPES, WepayService } from '@/common/wechat/pay';

import {
  isRefundNotifyResource,
  isTransactionNotifyResource,
  type WepayRefundNotifyResource,
  type WepayTransactionNotifyResource,
} from './payments.dto';

/** 回调路由路径，作为幂等键的防篡改校验维度 */
const WEPAY_NOTIFY_PATH = '/v1/payments/wepay/notify';

/** 幂等作用域标识 */
const WEPAY_NOTIFY_ACTOR = 'wepay:notify';

/** 微信回调成功状态码：微信仅判断状态码，204 空响应体是最干净的契约 */
const WEPAY_NOTIFY_SUCCESS_STATUS = 204;

/** 回调幂等缓存有效期（秒）：覆盖微信最长 24 小时的重投窗口 */
const WEPAY_NOTIFY_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * 支付回调处理服务
 *
 * 职责：
 * 1. 验签 + 解密（委托 WepayService，基建层只提供纯能力）；
 * 2. 以回调通知 ID 为键做幂等去重（微信会重复投递直到收到 2xx）；
 * 3. 将可信结果发布为内部领域事件，是否广播/落库由订阅方决定。
 *
 * 本轮不落库：订单持久化、状态机与对账在后续迭代接入。
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly wepay: WepayService,
    private readonly idempotency: IdempotencyService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 处理微信支付结果回调
   *
   * 重复投递时直接返回（视为已受理），确保微信侧停止重试；
   * 处理失败时释放幂等锁并上抛，令微信在退避窗口后重投。
   */
  async handleWepayNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<void> {
    const payload = await this.wepay.verifyAndDecryptNotify(headers, rawBody);
    const payloadHash = this.idempotency.computePayloadHash(payload);

    const acquired = await this.idempotency.acquire({
      key: payload.id,
      actor: WEPAY_NOTIFY_ACTOR,
      requestPath: WEPAY_NOTIFY_PATH,
      payloadHash,
      ttlSeconds: WEPAY_NOTIFY_IDEMPOTENCY_TTL_SECONDS,
      fallback: 'fail-closed',
    });

    if (!acquired.acquired) {
      this.logger.debug(`微信支付回调已受理过，忽略重复投递：notifyId=${payload.id}`);
      return;
    }

    try {
      this.dispatch(payload);
      await this.idempotency.complete({
        cacheKey: acquired.cacheKey,
        lockKey: acquired.lockKey,
        lockToken: acquired.lockToken,
        requestPath: WEPAY_NOTIFY_PATH,
        payloadHash,
        statusCode: WEPAY_NOTIFY_SUCCESS_STATUS,
        responseBody: {},
      });
      this.logger.log(`微信支付回调处理完成：eventType=${payload.eventType}，notifyId=${payload.id}`);
    } catch (error) {
      await this.idempotency.fail({ lockKey: acquired.lockKey, lockToken: acquired.lockToken });
      throw error;
    }
  }

  /** 按事件类型分派领域事件；未识别的回调仅发收妥事件，不做业务处理 */
  private dispatch(payload: WepayNotifyPayload): void {
    this.eventEmitter.emit(PAYMENT_EVENTS.NOTIFY_RECEIVED, {
      notifyId: payload.id,
      eventType: payload.eventType,
      resourceType: payload.resourceType,
      summary: payload.summary,
      createTime: payload.createTime,
      resource: payload.resource,
    });

    if (this.isTransactionSucceeded(payload)) {
      this.eventEmitter.emit(PAYMENT_EVENTS.SUCCEEDED, this.buildSucceededEvent(payload));
      return;
    }

    if (this.isRefundSucceeded(payload)) {
      this.eventEmitter.emit(PAYMENT_EVENTS.REFUNDED, this.buildRefundedEvent(payload));
      return;
    }

    // 退款异常/关闭不会再有后续回调，必须显式暴露给业务侧做人工介入或重新发起
    if (this.isRefundFailed(payload)) {
      this.eventEmitter.emit(PAYMENT_EVENTS.REFUND_FAILED, this.buildRefundFailedEvent(payload));
      return;
    }

    this.logger.debug(`微信支付回调无需业务处理：eventType=${payload.eventType}`);
  }

  /** 支付成功判定：事件类型与资源 trade_state 必须同时成立 */
  private isTransactionSucceeded(payload: WepayNotifyPayload): boolean {
    return payload.eventType === WEPAY_EVENT_TYPES.TRANSACTION_SUCCESS && isTransactionNotifyResource(payload.resource);
  }

  /** 退款成功判定：事件类型与资源 refund_status 必须同时成立 */
  private isRefundSucceeded(payload: WepayNotifyPayload): boolean {
    return payload.eventType === WEPAY_EVENT_TYPES.REFUND_SUCCESS && isRefundNotifyResource(payload.resource);
  }

  /** 退款未成功判定：REFUND.ABNORMAL 与 REFUND.CLOSED 共用同一业务出口 */
  private isRefundFailed(payload: WepayNotifyPayload): boolean {
    const isFailEvent =
      payload.eventType === WEPAY_EVENT_TYPES.REFUND_ABNORMAL || payload.eventType === WEPAY_EVENT_TYPES.REFUND_CLOSED;
    return isFailEvent && isRefundNotifyResource(payload.resource);
  }

  /** 依据事件类型确定退款未成功状态 */
  private resolveRefundFailStatus(eventType: string): WepayRefundFailStatus {
    return eventType === WEPAY_EVENT_TYPES.REFUND_CLOSED ? 'CLOSED' : 'ABNORMAL';
  }

  /** 构造支付成功事件载荷 */
  private buildSucceededEvent(payload: WepayNotifyPayload): PaymentSucceededEvent {
    const resource = payload.resource as unknown as WepayTransactionNotifyResource;
    return {
      notifyId: payload.id,
      eventType: payload.eventType,
      outTradeNo: resource.out_trade_no,
      transactionId: resource.transaction_id,
      amount: {
        total: resource.amount?.total ?? 0,
        ...(resource.amount?.payer_total === undefined ? {} : { payerTotal: resource.amount.payer_total }),
        ...(resource.amount?.currency === undefined ? {} : { currency: resource.amount.currency }),
      },
      ...(resource.payer?.openid ? { payerOpenid: resource.payer.openid } : {}),
      ...(resource.attach ? { attach: resource.attach } : {}),
      ...(resource.success_time ? { successTime: resource.success_time } : {}),
    };
  }

  /** 构造退款成功事件载荷 */
  private buildRefundedEvent(payload: WepayNotifyPayload): PaymentRefundedEvent {
    const resource = payload.resource as unknown as WepayRefundNotifyResource;
    return {
      notifyId: payload.id,
      eventType: payload.eventType,
      outTradeNo: resource.out_trade_no,
      outRefundNo: resource.out_refund_no,
      refundId: resource.refund_id,
      transactionId: resource.transaction_id,
      amount: {
        total: resource.amount?.total ?? 0,
        refund: resource.amount?.refund ?? 0,
      },
      ...(resource.success_time ? { successTime: resource.success_time } : {}),
    };
  }

  /** 构造退款未成功事件载荷 */
  private buildRefundFailedEvent(payload: WepayNotifyPayload): PaymentRefundFailedEvent {
    const resource = payload.resource as unknown as WepayRefundNotifyResource;
    return {
      notifyId: payload.id,
      eventType: payload.eventType,
      outTradeNo: resource.out_trade_no,
      outRefundNo: resource.out_refund_no,
      refundId: resource.refund_id,
      transactionId: resource.transaction_id,
      status: this.resolveRefundFailStatus(payload.eventType),
      amount: {
        total: resource.amount?.total ?? 0,
        refund: resource.amount?.refund ?? 0,
      },
    };
  }
}

import type { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PAYMENT_EVENTS } from '@/common/events';
import type { IdempotencyService } from '@/common/idempotency';
import type { WepayService } from '@/common/wechat/pay';
import { PaymentsService } from '@/features/client/payments/payments.service';

/** 构造一次回调处理所需的依赖替身 */
function buildService(options: { acquired?: boolean; completeRejects?: boolean; payloadEvents?: string }) {
  const eventType = options.payloadEvents ?? 'TRANSACTION.SUCCESS';
  const payload = {
    id: 'notify-1',
    eventType,
    resourceType: 'encrypt-resource',
    summary: '支付成功',
    createTime: '2026-01-01T00:00:00+08:00',
    resource: eventType.startsWith('REFUND.')
      ? {
          out_trade_no: 'ORDER-1',
          transaction_id: 'TX-1',
          out_refund_no: 'REFUND-1',
          refund_id: 'RID-1',
          refund_status: eventType.slice('REFUND.'.length),
          amount: { total: 100, refund: 50 },
        }
      : {
          out_trade_no: 'ORDER-1',
          transaction_id: 'TX-1',
          trade_state: 'SUCCESS',
          payer: { openid: 'openid-1' },
          amount: { total: 100, payer_total: 100, currency: 'CNY' },
        },
  };

  const wepay = {
    verifyAndDecryptNotify: vi.fn(async () => payload),
  } as unknown as WepayService;

  const idempotency = {
    computePayloadHash: vi.fn(() => 'payload-hash'),
    acquire: vi.fn(async () =>
      options.acquired === false
        ? { acquired: false, cached: { statusCode: 204, body: {} } }
        : { acquired: true, lockToken: 'lock-token', cacheKey: 'cache-key', lockKey: 'lock-key' },
    ),
    complete: vi.fn(async () => {
      if (options.completeRejects) {
        throw new Error('redis unavailable');
      }
    }),
    fail: vi.fn(async () => undefined),
    // 长事务锁续租心跳：返回停止函数（业务侧在 finally 中调用）
    startLockHeartbeat: vi.fn(() => vi.fn()),
  } as unknown as IdempotencyService;

  const emitter = { emitAsync: vi.fn(async () => []) } as unknown as EventEmitter2;

  return { service: new PaymentsService(wepay, idempotency, emitter), idempotency, emitter, wepay };
}

describe('支付回调处理服务', () => {
  let context: ReturnType<typeof buildService>;

  beforeEach(() => {
    context = buildService({});
  });

  it('首次回调应验签解密、抢占幂等锁并发布支付成功事件', async () => {
    await context.service.handleWepayNotify({ timestamp: '1' }, '{"raw":true}');

    expect(context.wepay.verifyAndDecryptNotify).toHaveBeenCalledWith({ timestamp: '1' }, '{"raw":true}');
    // 以回调通知 ID 为幂等键，失败关闭（Redis 异常时让微信重投而非放行）
    expect(context.idempotency.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'notify-1',
        actor: 'wepay:notify',
        requestPath: '/v1/payments/wepay/notify',
        payloadHash: 'payload-hash',
        fallback: 'fail-closed',
      }),
    );

    expect(context.emitter.emitAsync).toHaveBeenCalledWith(
      PAYMENT_EVENTS.NOTIFY_RECEIVED,
      expect.objectContaining({ notifyId: 'notify-1', eventType: 'TRANSACTION.SUCCESS' }),
    );
    expect(context.emitter.emitAsync).toHaveBeenCalledWith(
      PAYMENT_EVENTS.SUCCEEDED,
      expect.objectContaining({
        outTradeNo: 'ORDER-1',
        transactionId: 'TX-1',
        payerOpenid: 'openid-1',
        amount: { total: 100, payerTotal: 100, currency: 'CNY' },
      }),
    );
    expect(context.idempotency.complete).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 204, requestPath: '/v1/payments/wepay/notify' }),
    );
  });

  it('重复投递应直接返回且不重复发布事件', async () => {
    const duplicate = buildService({ acquired: false });

    await duplicate.service.handleWepayNotify({}, '{}');

    expect(duplicate.emitter.emitAsync).not.toHaveBeenCalled();
    expect(duplicate.idempotency.complete).not.toHaveBeenCalled();
  });

  it('退款成功回调应发布退款事件', async () => {
    const refunded = buildService({ payloadEvents: 'REFUND.SUCCESS' });

    await refunded.service.handleWepayNotify({}, '{}');

    expect(refunded.emitter.emitAsync).toHaveBeenCalledWith(
      PAYMENT_EVENTS.REFUNDED,
      expect.objectContaining({
        outTradeNo: 'ORDER-1',
        outRefundNo: 'REFUND-1',
        refundId: 'RID-1',
        amount: { total: 100, refund: 50 },
      }),
    );
    expect(refunded.emitter.emitAsync).not.toHaveBeenCalledWith(PAYMENT_EVENTS.SUCCEEDED, expect.anything());
  });

  it('退款异常回调应发布 ABNORMAL 状态的退款未成功事件', async () => {
    const abnormal = buildService({ payloadEvents: 'REFUND.ABNORMAL' });

    await abnormal.service.handleWepayNotify({}, '{}');

    expect(abnormal.emitter.emitAsync).toHaveBeenCalledWith(
      PAYMENT_EVENTS.REFUND_FAILED,
      expect.objectContaining({
        outTradeNo: 'ORDER-1',
        outRefundNo: 'REFUND-1',
        refundId: 'RID-1',
        status: 'ABNORMAL',
        amount: { total: 100, refund: 50 },
      }),
    );
    expect(abnormal.emitter.emitAsync).not.toHaveBeenCalledWith(PAYMENT_EVENTS.REFUNDED, expect.anything());
  });

  it('退款关闭回调应发布 CLOSED 状态的退款未成功事件', async () => {
    const closed = buildService({ payloadEvents: 'REFUND.CLOSED' });

    await closed.service.handleWepayNotify({}, '{}');

    expect(closed.emitter.emitAsync).toHaveBeenCalledWith(
      PAYMENT_EVENTS.REFUND_FAILED,
      expect.objectContaining({ status: 'CLOSED', outRefundNo: 'REFUND-1' }),
    );
    expect(closed.emitter.emitAsync).not.toHaveBeenCalledWith(PAYMENT_EVENTS.REFUNDED, expect.anything());
  });

  it('资源结构与事件类型不匹配时应只发布收妥事件', async () => {
    const mismatched = buildService({ payloadEvents: 'REFUND.SUCCESS' });
    // 事件类型为退款但资源仍是交易结构
    (mismatched.wepay.verifyAndDecryptNotify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'notify-2',
      eventType: 'REFUND.SUCCESS',
      resourceType: 'encrypt-resource',
      summary: 's',
      createTime: 'c',
      resource: { out_trade_no: 'ORDER-1', transaction_id: 'TX-1', trade_state: 'SUCCESS' },
    });

    await mismatched.service.handleWepayNotify({}, '{}');

    expect(mismatched.emitter.emitAsync).toHaveBeenCalledWith(PAYMENT_EVENTS.NOTIFY_RECEIVED, expect.anything());
    expect(mismatched.emitter.emitAsync).not.toHaveBeenCalledWith(PAYMENT_EVENTS.REFUNDED, expect.anything());
    expect(mismatched.emitter.emitAsync).not.toHaveBeenCalledWith(PAYMENT_EVENTS.SUCCEEDED, expect.anything());
  });

  it('落库完成阶段失败时应释放幂等锁并上抛，令微信重投', async () => {
    const failing = buildService({ completeRejects: true });

    await expect(failing.service.handleWepayNotify({}, '{}')).rejects.toThrowError('redis unavailable');
    expect(failing.idempotency.fail).toHaveBeenCalledWith({ lockKey: 'lock-key', lockToken: 'lock-token' });
  });

  it('验签失败应在抢占幂等锁之前中断，不产生任何副作用', async () => {
    context = buildService({});
    (context.wepay.verifyAndDecryptNotify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('验签失败'));

    await expect(context.service.handleWepayNotify({}, '{}')).rejects.toThrowError('验签失败');
    expect(context.idempotency.acquire).not.toHaveBeenCalled();
    expect(context.emitter.emitAsync).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';

import { WepayException } from '@/common/wechat/pay/wepay.exception';
import { assertBillDate, assertRefundInput } from '@/common/wechat/pay/wepay.validator';

/** 固定基准时刻：2026-05-11 02:00 UTC，即北京时间 05-11 10:00（账单就绪的临界点） */
const NOW = Date.UTC(2026, 4, 11, 2, 0, 0);

/** 捕获校验函数抛出的领域异常 */
function capture(fn: () => void): WepayException {
  try {
    fn();
  } catch (error) {
    return error as WepayException;
  }
  throw new Error('期望抛出 WepayException，但函数正常返回');
}

describe('退款入参校验', () => {
  const base = { outRefundNo: 'REFUND-1', outTradeNo: 'ORDER-1', amount: { refund: 100, total: 100 } };

  it('合法入参应通过校验', () => {
    expect(() => assertRefundInput(base)).not.toThrow();
    expect(() => assertRefundInput({ ...base, transactionId: 'TX-1', outTradeNo: undefined })).not.toThrow();
  });

  it('缺少退款单号或交易标识时应以 400 拦截', () => {
    const noRefundNo = capture(() => assertRefundInput({ ...base, outRefundNo: '' }));
    expect(noRefundNo.wepayCode).toBe('WEPAY_REFUND_NO_MISSING');
    expect(noRefundNo.getStatus()).toBe(400);

    const noTarget = capture(() => assertRefundInput({ ...base, outTradeNo: undefined }));
    expect(noTarget.wepayCode).toBe('WEPAY_REFUND_TARGET_MISSING');
    expect(noTarget.getStatus()).toBe(400);
  });

  it('金额非正整数或超出订单总额时应以 400 拦截', () => {
    const zeroTotal = capture(() => assertRefundInput({ ...base, amount: { refund: 1, total: 0 } }));
    expect(zeroTotal.wepayCode).toBe('WEPAY_REFUND_AMOUNT_INVALID');

    const zeroRefund = capture(() => assertRefundInput({ ...base, amount: { refund: 0, total: 100 } }));
    expect(zeroRefund.wepayCode).toBe('WEPAY_REFUND_AMOUNT_INVALID');

    const fractional = capture(() => assertRefundInput({ ...base, amount: { refund: 10.5, total: 100 } }));
    expect(fractional.wepayCode).toBe('WEPAY_REFUND_AMOUNT_INVALID');

    const exceeded = capture(() => assertRefundInput({ ...base, amount: { refund: 101, total: 100 } }));
    expect(exceeded.wepayCode).toBe('WEPAY_REFUND_AMOUNT_EXCEEDED');
    expect(exceeded.getStatus()).toBe(400);
  });
});

describe('账单日期校验', () => {
  it('已过就绪时刻且未超期的日期应通过', () => {
    // 账单日 2026-05-10 → 就绪时刻 2026-05-11 10:00 北京时间（正好为 NOW）
    expect(() => assertBillDate('2026-05-10', NOW)).not.toThrow();
    // 恰好 93 天：仍在可下载范围内
    expect(() => assertBillDate('2026-02-06', NOW)).not.toThrow();
  });

  it('账单日尚未到次日 10:00（北京时间）时应报告未就绪', () => {
    const sameDay = capture(() => assertBillDate('2026-05-11', NOW));
    expect(sameDay.wepayCode).toBe('WEPAY_BILL_NOT_READY');
    expect(sameDay.getStatus()).toBe(400);

    // 次日 09:59 北京时间（01:59 UTC）仍差一分钟
    const justBefore = capture(() => assertBillDate('2026-05-11', Date.UTC(2026, 4, 12, 1, 59, 0)));
    expect(justBefore.wepayCode).toBe('WEPAY_BILL_NOT_READY');
  });

  it('日期格式非法或为不存在的日期时应报告格式错误', () => {
    for (const invalid of ['2026/05/10', '20260510', '2026-5-10', '', '2026-02-30', '2026-13-01']) {
      const error = capture(() => assertBillDate(invalid, NOW));
      expect(error.wepayCode).toBe('WEPAY_BILL_DATE_INVALID');
      expect(error.getStatus()).toBe(400);
    }
  });

  it('超出可下载回溯范围时应报告超期', () => {
    // 94 天：超出宽松边界 93 天
    const expired = capture(() => assertBillDate('2026-02-05', NOW));
    expect(expired.wepayCode).toBe('WEPAY_BILL_DATE_OUT_OF_RANGE');
    expect(expired.getStatus()).toBe(400);

    expect(capture(() => assertBillDate('2026-01-01', NOW)).wepayCode).toBe('WEPAY_BILL_DATE_OUT_OF_RANGE');
  });
});

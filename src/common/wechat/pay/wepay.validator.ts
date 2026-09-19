import type { WepayRefundInput } from './interfaces/wepay.interface';
import { WEPAY_BILL_MAX_AGE_DAYS, WEPAY_BILL_READY_UTC_HOUR } from './wepay.constants';
import { WepayException } from './wepay.exception';

/**
 * 校验退款申请入参
 *
 * 微信侧对缺参一律返回 `PARAM_ERROR`(400)，本地前置校验可在发起网络请求前拦截
 * 必然失败的调用；状态码由 {@link WEPAY_ERROR_MAP} 统一映射，与微信保持一致（同归 400）。
 */
export function assertRefundInput(input: WepayRefundInput): void {
  if (!input.outRefundNo) {
    throw new WepayException('WEPAY_REFUND_NO_MISSING', '缺少商户退款单号 outRefundNo');
  }

  if (!input.transactionId && !input.outTradeNo) {
    throw new WepayException('WEPAY_REFUND_TARGET_MISSING', '退款必须提供 transactionId 或 outTradeNo 之一');
  }

  const { total, refund } = input.amount;
  if (!Number.isInteger(total) || total <= 0) {
    throw new WepayException('WEPAY_REFUND_AMOUNT_INVALID', '退款入参 amount.total 必须为正整数（单位：分）');
  }
  if (!Number.isInteger(refund) || refund <= 0) {
    throw new WepayException('WEPAY_REFUND_AMOUNT_INVALID', '退款入参 amount.refund 必须为正整数（单位：分）');
  }
  if (refund > total) {
    throw new WepayException(
      'WEPAY_REFUND_AMOUNT_EXCEEDED',
      `退款金额（${refund} 分）不得超过订单总金额（${total} 分）`,
    );
  }
}

/** 解析 yyyy-MM-DD，非法日期（含 2 月 30 日这类不存在的日期）返回 null */
function parseBillDate(billDate: string): { year: number; month: number; day: number } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(billDate);
  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** 账单就绪时刻（UTC 毫秒）：账单日次日北京时间 10:00，即 UTC 02:00 */
function billReadyAt(key: { year: number; month: number; day: number }): number {
  return Date.UTC(key.year, key.month - 1, key.day + 1, WEPAY_BILL_READY_UTC_HOUR);
}

/**
 * 校验账单下载日期
 *
 * 微信账单在账单日**次日北京时间 10:00** 后才生成，且仅支持近三个月内的下载申请。
 * 本地前置拦截可消除绝大多数注定 `STATEMENT_CREATING` 的无效请求
 * （跨天等待请交由业务侧定时任务调度，不在请求链路中阻塞）。
 *
 * @param now 当前时间毫秒（便于测试注入）
 */
export function assertBillDate(billDate: string, now = Date.now()): void {
  const key = parseBillDate(billDate);
  if (!key) {
    throw new WepayException('WEPAY_BILL_DATE_INVALID', `账单日期格式非法（${billDate}），应为 yyyy-MM-DD`);
  }

  const readyAt = billReadyAt(key);
  if (now < readyAt) {
    throw new WepayException('WEPAY_BILL_NOT_READY', `账单尚未生成：${billDate} 的账单需在次日北京时间 10:00 后下载`);
  }

  if (now - readyAt > WEPAY_BILL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new WepayException(
      'WEPAY_BILL_DATE_OUT_OF_RANGE',
      `仅支持下载近三个月内的账单（请求日期 ${billDate} 已超期）`,
    );
  }
}

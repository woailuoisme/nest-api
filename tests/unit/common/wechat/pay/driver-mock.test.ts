import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockWepayDriver } from '@/common/wechat/pay/drivers/mock.driver';
import { WepayException } from '@/common/wechat/pay/wepay.exception';

const API_V3_KEY = 'nestforge-mock-api-v3-key'.padEnd(32, '0');

/** 将 UTC 偏移后的时间格式化为 yyyy-MM-DD */
function formatBillDate(offsetMs: number): string {
  const date = new Date(Date.now() + offsetMs);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** 已就绪且在可下载范围内的账单日期（2 天前） */
function readyBillDate(): string {
  return formatBillDate(-2 * 24 * 60 * 60 * 1000);
}

/** 当日账单必然未就绪 */
function todayBillDate(): string {
  return formatBillDate(0);
}

let driver: MockWepayDriver;

beforeEach(() => {
  driver = new MockWepayDriver({
    appid: 'wx-mock-appid',
    mchid: '1900000000',
    apiV3Key: API_V3_KEY,
    notifyUrl: 'https://api.test/v1/payments/wepay/notify',
    logger: new Logger('MockWepayDriverTest'),
  });
});

describe('微信支付 v3 mock 驱动', () => {
  it('Native 下单应返回确定性 code_url（同一订单号可复现）', async () => {
    const first = await driver.createNative({ outTradeNo: 'ORDER-A', description: 'x', amount: { total: 1 } });
    const second = await driver.createNative({ outTradeNo: 'ORDER-A', description: 'x', amount: { total: 1 } });
    const other = await driver.createNative({ outTradeNo: 'ORDER-B', description: 'x', amount: { total: 1 } });

    expect(first.codeUrl).toBe(second.codeUrl);
    expect(first.codeUrl).not.toBe(other.codeUrl);
    expect(first.codeUrl.startsWith('weixin://wxpay/bizpayurl?pr=')).toBe(true);
  });

  it('JSAPI 与 App 下单应返回 prepay_id 与二次签名参数', async () => {
    const jsapi = await driver.createJsapi({
      outTradeNo: 'ORDER-C',
      description: 'x',
      amount: { total: 1 },
      payer: { openid: 'openid-1' },
    });
    const app = await driver.createApp({ outTradeNo: 'ORDER-C', description: 'x', amount: { total: 1 } });

    expect(jsapi.prepayId).toBe(app.prepayId);
    expect(jsapi.payParams.package).toBe(`prepay_id=${jsapi.prepayId}`);
    expect(jsapi.payParams.signType).toBe('RSA');
    expect(app.payParams.package).toBe('Sign=WXPay');
    expect(app.payParams.partnerId).toBe('1900000000');
  });

  it('H5 下单应返回跳转链接', async () => {
    const result = await driver.createH5({
      outTradeNo: 'ORDER-D',
      description: 'x',
      amount: { total: 1 },
      sceneInfo: { payer_client_ip: '127.0.0.1', h5_info: { type: 'Wap', app_name: 'test' } },
    });

    expect(result.h5Url).toContain('checkmweb?prepay_id=');
  });

  it('订单默认应处于 NOTPAY，关单后变为 CLOSED', async () => {
    const initial = await driver.queryByOutTradeNo('ORDER-E');
    expect(initial.tradeState).toBe('NOTPAY');

    await driver.close('ORDER-E');
    const closed = await driver.queryByOutTradeNo('ORDER-E');
    expect(closed.tradeState).toBe('CLOSED');
  });

  it('覆写订单状态应影响后续查询（模拟支付成功）', async () => {
    driver.setTradeState('ORDER-F', 'SUCCESS');

    const result = await driver.queryByOutTradeNo('ORDER-F');

    expect(result.tradeState).toBe('SUCCESS');
    expect(result.transactionId).toBeTruthy();
    expect(result.amount?.total).toBeGreaterThan(0);
  });

  it('全额退款应返回 SUCCESS、可通过退款单号回查并把交易置为 REFUND', async () => {
    const refunded = await driver.refund({
      outRefundNo: 'REFUND-1',
      outTradeNo: 'ORDER-G',
      amount: { refund: 100, total: 100 },
    });

    expect(refunded.status).toBe('SUCCESS');
    expect(refunded.amount).toMatchObject({ refund: 100, total: 100 });

    const queried = await driver.queryRefund('REFUND-1');
    expect(queried.refundId).toBe(refunded.refundId);

    const trade = await driver.queryByOutTradeNo('ORDER-G');
    expect(trade.tradeState).toBe('REFUND');
  });

  it('部分退款不应把交易置为已全额退款', async () => {
    await driver.refund({ outRefundNo: 'REFUND-PART', outTradeNo: 'ORDER-PART', amount: { refund: 50, total: 100 } });

    const trade = await driver.queryByOutTradeNo('ORDER-PART');
    expect(trade.tradeState).toBe('NOTPAY');
  });

  it('查询不存在的退款单应返回 404 语义的业务错误', async () => {
    const error = (await driver
      .queryRefund('NOT-EXIST')
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    // mock 与 real 驱动统一使用官方错误码 RESOURCE_NOT_EXISTS
    expect(error.wepayCode).toBe('RESOURCE_NOT_EXISTS');
    expect(error.getStatus()).toBe(404);
  });

  it('退款入参非法时应与 real 驱动一致地本地拦截', async () => {
    const noTarget = (await driver
      .refund({ outRefundNo: 'REFUND-X', amount: { refund: 10, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(noTarget.wepayCode).toBe('WEPAY_REFUND_TARGET_MISSING');

    const exceeded = (await driver
      .refund({ outRefundNo: 'REFUND-Y', outTradeNo: 'ORDER-Y', amount: { refund: 200, total: 100 } })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;
    expect(exceeded.wepayCode).toBe('WEPAY_REFUND_AMOUNT_EXCEEDED');
  });

  it('issueNotify 产出的回调报文应能被真实验签与解密链路消费', async () => {
    const resource = { out_trade_no: 'ORDER-H', transaction_id: 'TX-H', trade_state: 'SUCCESS' };
    const message = driver.issueNotify({ eventType: 'TRANSACTION.SUCCESS', summary: '支付成功', resource });
    const headers = {
      timestamp: message.headers['wechatpay-timestamp'],
      nonce: message.headers['wechatpay-nonce'],
      serial: message.headers['wechatpay-serial'],
      signature: message.headers['wechatpay-signature'],
    };

    const payload = await driver.verifyAndDecryptNotify(headers, message.body);

    expect(payload.eventType).toBe('TRANSACTION.SUCCESS');
    expect(payload.resource).toEqual(resource);
  });

  it('issueNotify 报文被篡改后应验签失败', async () => {
    const message = driver.issueNotify({ eventType: 'TRANSACTION.SUCCESS', resource: { out_trade_no: 'ORDER-I' } });

    const error = (await driver
      .verifyAndDecryptNotify(
        {
          timestamp: message.headers['wechatpay-timestamp'],
          nonce: message.headers['wechatpay-nonce'],
          serial: message.headers['wechatpay-serial'],
          signature: message.headers['wechatpay-signature'],
        },
        `${message.body} `,
      )
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_NOTIFY_SIGNATURE_INVALID');
    expect(error.getStatus()).toBe(401);
  });

  it('凭据序列号不匹配时应拒绝验签', async () => {
    const message = driver.issueNotify({ eventType: 'TRANSACTION.SUCCESS', resource: {} });

    const error = (await driver
      .verifyAndDecryptNotify(
        {
          timestamp: message.headers['wechatpay-timestamp'],
          nonce: message.headers['wechatpay-nonce'],
          serial: 'OTHER_SERIAL',
          signature: message.headers['wechatpay-signature'],
        },
        message.body,
      )
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_CERTIFICATE_UNRESOLVED');
  });

  it('账单应包含请求的账单日期', async () => {
    const billDate = readyBillDate();
    const tradeBill = await driver.downloadTradeBill({ billDate, billType: 'ALL' });
    const fundFlowBill = await driver.downloadFundFlowBill({ billDate, accountType: 'BASIC' });

    expect(tradeBill).toContain(billDate);
    expect(tradeBill).toContain('1900000000');
    expect(fundFlowBill).toContain(billDate);
  });

  it('账单日期门禁应与 real 驱动保持一致', async () => {
    const error = (await driver
      .downloadTradeBill({ billDate: todayBillDate(), billType: 'ALL' })
      .catch((caught: unknown) => caught as WepayException)) as unknown as WepayException;

    expect(error.wepayCode).toBe('WEPAY_BILL_NOT_READY');
    expect(error.getStatus()).toBe(400);
  });

  it('健康检查应报告 mock 驱动且为 up', async () => {
    await expect(driver.checkHealth()).resolves.toMatchObject({ status: 'up', driver: 'mock' });
  });
});

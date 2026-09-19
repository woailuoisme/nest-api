import { createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signMessage } from '@/common/wechat/pay/crypto/signer';
import { buildVerifyMessage } from '@/common/wechat/pay/crypto/verifier';
import { RealWepayDriver } from '@/common/wechat/pay/drivers/real.driver';

const PUBLIC_KEY_ID = 'PUB_KEY_ID_TEST';

let merchantPrivateKey: KeyObject;
let merchantPublicKey: KeyObject;
let driver: RealWepayDriver;

/** 构造带合法应答签名的 fetch 应答（二次签名测试不关注应答验签，故直接复用商户密钥对签名） */
function stubPrepayResponse(prepayId: string) {
  const bodyText = JSON.stringify({ prepay_id: prepayId });
  const receivedAt = new Date();
  const timestamp = Math.floor(receivedAt.getTime() / 1000).toString();
  const nonce = 'RESPONSE_NONCE';
  const headers = new Map<string, string>([
    ['wechatpay-timestamp', timestamp],
    ['wechatpay-nonce', nonce],
    ['wechatpay-serial', PUBLIC_KEY_ID],
    ['wechatpay-signature', signMessage(buildVerifyMessage(timestamp, nonce, bodyText), merchantPrivateKey)],
  ]);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const buffer = Buffer.from(bodyText, 'utf8');
      return {
        status: 200,
        text: async () => bodyText,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      };
    }),
  );
}

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  merchantPrivateKey = pair.privateKey;
  merchantPublicKey = pair.publicKey;
});

beforeEach(() => {
  driver = new RealWepayDriver({
    appid: 'wx-second-sign',
    mchid: '1900000002',
    serialNo: 'MCH-SERIAL-002',
    privateKey: merchantPrivateKey,
    apiV3Key: 'x'.repeat(32),
    notifyUrl: 'https://api.test/v1/payments/wepay/notify',
    publicKeyPem: merchantPublicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeyId: PUBLIC_KEY_ID,
    logger: new Logger('SecondSignTest'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('微信支付二次签名（JSAPI / App）', () => {
  it('JSAPI paySign 应对 appId\\ntimeStamp\\nnonceStr\\npackage 签名', async () => {
    stubPrepayResponse('PREPAY-JSAPI');

    const result = await driver.createJsapi({
      outTradeNo: 'ORDER-JSAPI',
      description: '测试商品',
      amount: { total: 100 },
      payer: { openid: 'openid-1' },
    });
    const { payParams } = result;
    const message = `${payParams.appId}\n${payParams.timeStamp}\n${payParams.nonceStr}\n${payParams.package}\n`;

    expect(payParams.package).toBe('prepay_id=PREPAY-JSAPI');
    expect(payParams.signType).toBe('RSA');
    expect(verifyWithMerchantKey(message, payParams.paySign)).toBe(true);
  });

  it('App sign 应对 appId\\ntimeStamp\\nnonceStr\\nprepayId 签名', async () => {
    stubPrepayResponse('PREPAY-APP');

    const result = await driver.createApp({
      outTradeNo: 'ORDER-APP',
      description: '测试商品',
      amount: { total: 100 },
    });
    const { payParams } = result;
    const message = `${payParams.appId}\n${payParams.timeStamp}\n${payParams.nonceStr}\n${payParams.prepayId}\n`;

    expect(payParams.package).toBe('Sign=WXPay');
    expect(payParams.partnerId).toBe('1900000002');
    expect(verifyWithMerchantKey(message, payParams.sign)).toBe(true);
  });

  it('JSAPI 与 App 的待签串不同：签名字段名与携带 prepay_id 的方式存在差异', () => {
    const appId = 'wx-second-sign';
    const timeStamp = '1760000000';
    const nonceStr = 'nonce';
    const prepayId = 'PREPAY-X';

    const jsapiMessage = `${appId}\n${timeStamp}\n${nonceStr}\nprepay_id=${prepayId}\n`;
    const appMessage = `${appId}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`;

    expect(jsapiMessage).not.toBe(appMessage);
    expect(jsapiMessage).toContain('prepay_id=');
    expect(appMessage.endsWith(`${prepayId}\n`)).toBe(true);
  });

  it('二次签名结果应为合法 base64 且每次 nonceStr 不同', async () => {
    stubPrepayResponse('PREPAY-NONCE');

    const first = await driver.createJsapi({
      outTradeNo: 'ORDER-NONCE-1',
      description: '测试商品',
      amount: { total: 100 },
      payer: { openid: 'openid-1' },
    });
    const second = await driver.createJsapi({
      outTradeNo: 'ORDER-NONCE-2',
      description: '测试商品',
      amount: { total: 100 },
      payer: { openid: 'openid-1' },
    });

    expect(first.payParams.paySign).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(first.payParams.nonceStr).toHaveLength(32);
    expect(first.payParams.nonceStr).not.toBe(second.payParams.nonceStr);
  });
});

/** 使用商户公钥校验二次签名 */
function verifyWithMerchantKey(message: string, signature: string): boolean {
  return createVerify('RSA-SHA256').update(message, 'utf8').verify(merchantPublicKey, signature, 'base64');
}

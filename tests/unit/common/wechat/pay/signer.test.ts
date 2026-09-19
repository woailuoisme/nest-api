import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { WEPAY_SIGN_TYPE } from '@/common/wechat/pay';
import {
  buildAuthorizationHeader,
  buildRequestSignMessage,
  loadPrivateKey,
  normalizePem,
  randomNonce,
  signMessage,
} from '@/common/wechat/pay/crypto/signer';
import { verifyMessage } from '@/common/wechat/pay/crypto/verifier';

let privateKey: KeyObject;
let publicKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
});

describe('微信支付 v3 签名器', () => {
  it('待签名串应为 METHOD\\nURL\\ntimestamp\\nnonce\\nbody\\n 五段结构', () => {
    const message = buildRequestSignMessage({
      method: 'post',
      urlPath: '/v3/pay/transactions/native',
      timestamp: '1554208460',
      nonceStr: '593BEC0C930BF1AFEB40B4A08C8FB242',
      body: '{"a":1}',
    });

    expect(message).toBe('POST\n/v3/pay/transactions/native\n1554208460\n593BEC0C930BF1AFEB40B4A08C8FB242\n{"a":1}\n');
  });

  it('无请求体时 body 段应为空但保留换行', () => {
    const message = buildRequestSignMessage({
      method: 'GET',
      urlPath: '/v3/certificates',
      timestamp: '1554208460',
      nonceStr: 'nonce',
      body: '',
    });

    expect(message).toBe('GET\n/v3/certificates\n1554208460\nnonce\n\n');
  });

  it('normalizePem 应还原 env 中转义的 \\n 并去除首尾空白', () => {
    expect(normalizePem('  -----BEGIN\\nKEY-----\\nabc\\n-----END-----  ')).toBe(
      '-----BEGIN\nKEY-----\nabc\n-----END-----',
    );
    expect(normalizePem('\n-----BEGIN-----\n')).toBe('-----BEGIN-----');
  });

  it('签名结果应可被对应公钥验签通过', () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const loaded = loadPrivateKey(pem.replace(/\n/g, '\\n'));
    const message = buildRequestSignMessage({
      method: 'POST',
      urlPath: '/v3/pay/transactions/jsapi',
      timestamp: '1554208460',
      nonceStr: 'nonce',
      body: '{}',
    });

    const signature = signMessage(message, loaded);
    expect(verifyMessage(message, signature, createPublicKey(publicKeyPem))).toBe(true);
    // base64 输出
    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('randomNonce 应为 32 位十六进制且每次不同', () => {
    const first = randomNonce();
    const second = randomNonce();

    expect(first).toHaveLength(32);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it('Authorization 头应携带签名算法、商户号、序列号与全部签名要素', () => {
    const header = buildAuthorizationHeader({
      mchid: '1900000001',
      serialNo: 'SERIAL-001',
      nonceStr: 'nonce',
      timestamp: '1554208460',
      signature: 'SIG',
    });

    expect(header.startsWith(WEPAY_SIGN_TYPE)).toBe(true);
    expect(header).toContain('mchid="1900000001"');
    expect(header).toContain('serial_no="SERIAL-001"');
    expect(header).toContain('nonce_str="nonce"');
    expect(header).toContain('timestamp="1554208460"');
    expect(header).toContain('signature="SIG"');
  });
});

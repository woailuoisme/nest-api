import { describe, expect, it } from 'vitest';
import { decryptAesGcmResource, encryptAesGcmResource } from '@/common/wechat/pay/crypto/cipher';

/** 32 字节 APIv3 密钥 */
const API_V3_KEY = 'nestforge-mock-api-v3-key'.padEnd(32, '0');

describe('微信支付 v3 报文加解密 (AES-256-GCM)', () => {
  it('加密后应以 base64 密文 + 尾部认证标签的形态输出，并可完整解密回原文', () => {
    const plaintext = JSON.stringify({ out_trade_no: 'ORDER-1', trade_state: 'SUCCESS' });
    const encrypted = encryptAesGcmResource(plaintext, API_V3_KEY, 'transaction');

    expect(encrypted.algorithm).toBe('AEAD_AES_256_GCM');
    expect(encrypted.associated_data).toBe('transaction');
    expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(decryptAesGcmResource(encrypted, API_V3_KEY)).toBe(plaintext);
  });

  it('associated_data 缺失时应按空字符串参与认证', () => {
    const encrypted = encryptAesGcmResource('{"a":1}', API_V3_KEY);

    expect(encrypted.associated_data).toBe('');
    expect(decryptAesGcmResource({ ...encrypted, associated_data: undefined }, API_V3_KEY)).toBe('{"a":1}');
  });

  it('使用错误的 APIv3 密钥解密应失败', () => {
    const encrypted = encryptAesGcmResource('{"a":1}', API_V3_KEY);
    const wrongKey = 'x'.repeat(32);

    expect(() => decryptAesGcmResource(encrypted, wrongKey)).toThrow();
  });

  it('associated_data 被篡改应导致认证失败', () => {
    const encrypted = encryptAesGcmResource('{"a":1}', API_V3_KEY, 'transaction');

    expect(() => decryptAesGcmResource({ ...encrypted, associated_data: 'refund' }, API_V3_KEY)).toThrow();
  });

  it('密文被篡改应导致认证失败', () => {
    const encrypted = encryptAesGcmResource('{"a":1}', API_V3_KEY);
    const tampered = Buffer.from(encrypted.ciphertext, 'base64');
    tampered[0] ^= 0xff;

    expect(() =>
      decryptAesGcmResource({ ...encrypted, ciphertext: tampered.toString('base64') }, API_V3_KEY),
    ).toThrow();
  });

  it('APIv3 密钥长度非 32 字节时应明确报错', () => {
    expect(() => decryptAesGcmResource({ ciphertext: 'AAAA', nonce: 'nonce' }, 'too-short')).toThrowError(
      /必须为 32 字节/,
    );
  });

  it('密文长度不足以拆分认证标签时应明确报错', () => {
    expect(() =>
      decryptAesGcmResource({ ciphertext: Buffer.alloc(8).toString('base64'), nonce: 'nonce' }, API_V3_KEY),
    ).toThrowError(/密文长度非法/);
  });
});

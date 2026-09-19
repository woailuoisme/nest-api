import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { signMessage } from '@/common/wechat/pay/crypto/signer';
import {
  assertFreshTimestamp,
  buildVerifyMessage,
  loadPublicKey,
  verifyMessage,
} from '@/common/wechat/pay/crypto/verifier';

const NOW = 1_760_000_000_000; // 固定基准时间，避免测试受系统时钟影响

let privateKey: KeyObject;
let publicKey: KeyObject;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

describe('微信支付 v3 验签器', () => {
  it('待验签串应为 timestamp\\nnonce\\nbody\\n 结构', () => {
    expect(buildVerifyMessage('1554208460', 'nonce', '{"a":1}')).toBe('1554208460\nnonce\n{"a":1}\n');
  });

  it('应通过原始报文验签，且报文被篡改后验签失败', () => {
    const body = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS' });
    const message = buildVerifyMessage('1554208460', 'nonce', body);
    const signature = signMessage(message, privateKey);

    expect(verifyMessage(message, signature, publicKey)).toBe(true);
    expect(verifyMessage(buildVerifyMessage('1554208460', 'nonce', `${body} `), signature, publicKey)).toBe(false);
    expect(verifyMessage(buildVerifyMessage('1554208461', 'nonce', body), signature, publicKey)).toBe(false);
  });

  it('畸形签名应返回 false 而非抛错', () => {
    const message = buildVerifyMessage('1554208460', 'nonce', '{}');

    expect(verifyMessage(message, 'not-a-base64-signature', publicKey)).toBe(false);
    expect(verifyMessage(message, '', publicKey)).toBe(false);
  });

  it('loadPublicKey 应同时支持标准 PEM 与 env 转义形态', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const escaped = pem.replace(/\n/g, '\\n');

    expect(loadPublicKey(escaped).export({ type: 'spki', format: 'pem' }).toString()).toBe(pem);
    expect(loadPublicKey(pem).asymmetricKeyType).toBe(createPublicKey(pem).asymmetricKeyType);
  });

  it('时间戳在容差窗口内应放行，越界应抛出疑似重放', () => {
    const fresh = String(Math.floor(NOW / 1000));
    expect(() => assertFreshTimestamp(fresh, 300, NOW)).not.toThrow();
    // 边界：正好 300 秒
    expect(() => assertFreshTimestamp(String(Math.floor(NOW / 1000) - 300), 300, NOW)).not.toThrow();
    // 越界：301 秒
    expect(() => assertFreshTimestamp(String(Math.floor(NOW / 1000) - 301), 300, NOW)).toThrowError(/疑似重放/);
    // 未来时间同样受限
    expect(() => assertFreshTimestamp(String(Math.floor(NOW / 1000) + 301), 300, NOW)).toThrowError(/疑似重放/);
  });

  it('非法时间戳应抛出明确错误', () => {
    expect(() => assertFreshTimestamp('not-a-number', 300, NOW)).toThrowError(/时间戳非法/);
  });
});

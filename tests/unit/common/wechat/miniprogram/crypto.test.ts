import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptUserData } from '@/common/wechat/miniprogram/crypto/aes-cbc';
import { buildSessionSignature } from '@/common/wechat/miniprogram/crypto/session-signature';
import { MiniprogramException } from '@/common/wechat/miniprogram/miniprogram.exception';

const APP_ID = 'wx-test-appid';

/** 生成 16 字节对称密钥并转为官方所用的 base64 形态 */
function randomKeyBase64(): string {
  return randomBytes(16).toString('base64');
}

/** 以 AES-128-CBC + PKCS#7 加密，模拟微信旧版开放数据的加密方式 */
function encryptAes128Cbc(plaintext: string, sessionKey: string, iv: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(sessionKey, 'base64'), Buffer.from(iv, 'base64'));
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

/** 期望抛出的小程序领域异常 */
function expectMiniprogramError(fn: () => unknown, code: string, pattern?: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(MiniprogramException);
  expect((caught as MiniprogramException).miniprogramCode).toBe(code);
  if (pattern) {
    expect((caught as MiniprogramException).message).toMatch(pattern);
  }
}

describe('登录态签名 (hmac_sha256)', () => {
  it('应等价于「以 session_key 为密钥、对空字符串做 HMAC-SHA256」的官方算法', () => {
    const sessionKey = randomKeyBase64();
    const expected = createHmac('sha256', sessionKey).update('').digest('hex');

    expect(buildSessionSignature(sessionKey)).toBe(expected);
  });

  it('签名内容默认为空字符串，显式传入内容时应参与计算', () => {
    const sessionKey = randomKeyBase64();

    expect(buildSessionSignature(sessionKey)).toBe(buildSessionSignature(sessionKey, ''));
    expect(buildSessionSignature(sessionKey, 'payload')).not.toBe(buildSessionSignature(sessionKey));
  });

  it('不同 session_key 应产生不同签名，且输出为小写十六进制', () => {
    const first = buildSessionSignature(randomKeyBase64());
    const second = buildSessionSignature(randomKeyBase64());

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});

describe('旧版开放数据解密 (AES-128-CBC)', () => {
  it('应能解密带水印的用户数据并还原中文与 emoji', () => {
    const sessionKey = randomKeyBase64();
    const iv = randomKeyBase64();
    const data = { nickName: '张三 🎉', language: 'zh_CN', watermark: { timestamp: 1700000000, appid: APP_ID } };
    const encryptedData = encryptAes128Cbc(JSON.stringify(data), sessionKey, iv);

    const decrypted = decryptUserData(sessionKey, encryptedData, iv);

    expect(decrypted).toEqual(data);
  });

  it('expectedAppid 与数据水印一致时应通过', () => {
    const sessionKey = randomKeyBase64();
    const iv = randomKeyBase64();
    const encryptedData = encryptAes128Cbc(
      JSON.stringify({ watermark: { timestamp: 1, appid: APP_ID } }),
      sessionKey,
      iv,
    );

    expect(decryptUserData(sessionKey, encryptedData, iv, { expectedAppid: APP_ID })).toMatchObject({
      watermark: { appid: APP_ID },
    });
  });

  it('expectedAppid 与水印不一致时应拒绝，阻断跨小程序密文重放', () => {
    const sessionKey = randomKeyBase64();
    const iv = randomKeyBase64();
    const encryptedData = encryptAes128Cbc(
      JSON.stringify({ watermark: { timestamp: 1, appid: 'wx-other-appid' } }),
      sessionKey,
      iv,
    );

    expectMiniprogramError(
      () => decryptUserData(sessionKey, encryptedData, iv, { expectedAppid: APP_ID }),
      'MINIPROGRAM_DECRYPT_FAILED',
      /水印 appid 不匹配/,
    );
  });

  it('使用错误的 session_key 解密应失败', () => {
    const iv = randomKeyBase64();
    const encryptedData = encryptAes128Cbc('{"a":1}', randomKeyBase64(), iv);

    expectMiniprogramError(() => decryptUserData(randomKeyBase64(), encryptedData, iv), 'MINIPROGRAM_DECRYPT_FAILED');
  });

  it('session_key 或 iv 长度不为 16 字节时应明确报错', () => {
    const iv = randomKeyBase64();
    const encryptedData = encryptAes128Cbc('{"a":1}', randomKeyBase64(), iv);
    const shortKey = randomBytes(8).toString('base64');

    expectMiniprogramError(
      () => decryptUserData(shortKey, encryptedData, iv),
      'MINIPROGRAM_DECRYPT_FAILED',
      /session_key 长度必须为 16 字节/,
    );
    expectMiniprogramError(
      () => decryptUserData(randomKeyBase64(), encryptedData, randomBytes(8).toString('base64')),
      'MINIPROGRAM_DECRYPT_FAILED',
      /iv 长度必须为 16 字节/,
    );
  });

  it('解密结果不是合法 JSON 时应明确报错', () => {
    const sessionKey = randomKeyBase64();
    const iv = randomKeyBase64();
    const encryptedData = encryptAes128Cbc('not-a-json', sessionKey, iv);

    expectMiniprogramError(
      () => decryptUserData(sessionKey, encryptedData, iv),
      'MINIPROGRAM_DECRYPT_FAILED',
      /不是合法 JSON/,
    );
  });
});

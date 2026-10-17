import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import { normalizePem } from './signer';

/**
 * 构造微信支付应答/回调待验签串：`timeStamp\nnonce\nbody\n`
 */
export function buildVerifyMessage(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}\n${nonce}\n${body}\n`;
}

/** 从 PEM 文本加载 RSA 公钥（微信支付公钥或平台证书） */
export function loadPublicKey(pem: string): KeyObject {
  return createPublicKey({ key: normalizePem(pem), format: 'pem' });
}

/** 校验 SHA256withRSA 签名（base64），任何解析异常均视为验签失败 */
export function verifyMessage(message: string, signature: string, publicKey: KeyObject): boolean {
  try {
    return createVerify('RSA-SHA256').update(message, 'utf8').verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * 校验时间戳新鲜度，超出容差窗口即抛错（防重放攻击）
 *
 * @param timestamp 秒级时间戳字符串
 * @param toleranceSeconds 允许的时钟偏移窗口（秒）
 * @param now 当前时间毫秒（便于测试注入）
 */
export function assertFreshTimestamp(timestamp: string, toleranceSeconds: number, now = Date.now()): void {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw new Error('微信支付签名时间戳非法');
  }

  const drift = Math.abs(Math.floor(now / 1000) - seconds);
  if (drift > toleranceSeconds) {
    throw new Error(`微信支付签名时间戳超出 ${toleranceSeconds} 秒容差（偏差 ${drift} 秒），疑似重放攻击`);
  }
}

import type { KeyObject } from 'node:crypto';

import { loadPublicKey } from '../crypto/verifier';

/**
 * 微信支付公钥存储器（2024 年后新商户默认模式）
 *
 * 公钥由商户平台下载后经 `WEPAY_PUBLIC_KEY` / `WEPAY_PUBLIC_KEY_ID` 注入，
 * 无需向微信拉取、不存在轮转问题，验签时按应答头 `Wechatpay-Serial` 精确匹配公钥 ID。
 */
export class PublicKeyStore {
  private readonly key: KeyObject;

  constructor(
    pem: string,
    private readonly keyIdValue: string,
  ) {
    this.key = loadPublicKey(pem);
  }

  /** 微信支付公钥 ID，形如 PUB_KEY_ID_xxx */
  get keyId(): string {
    return this.keyIdValue;
  }

  /** 仅当 serial 与本公钥 ID 一致时返回公钥，避免跨凭据误验签 */
  resolve(serial: string | undefined): KeyObject | null {
    if (!serial || serial !== this.keyIdValue) {
      return null;
    }
    return this.key;
  }
}

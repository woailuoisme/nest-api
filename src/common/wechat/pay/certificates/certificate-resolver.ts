import type { KeyObject } from 'node:crypto';

import type { WepayCertificateMode } from '../interfaces/wepay.interface';
import type { PlatformCertificateStore } from './platform-cert.store';
import type { PublicKeyStore } from './public-key.store';

/**
 * 验签凭据解析门面
 *
 * 策略优先级：配置了微信支付公钥则走公钥模式（零下载零轮转），
 * 否则回退平台证书模式（自动下载 + 惰性刷新）。两者互斥，构造时由 real 驱动决定。
 */
export class WepayCertificateResolver {
  constructor(
    private readonly publicKeyStore: PublicKeyStore | null,
    private readonly platformCertStore: PlatformCertificateStore | null,
  ) {}

  /** 当前生效的凭据模式 */
  get mode(): WepayCertificateMode {
    if (this.publicKeyStore) {
      return 'public-key';
    }
    if (this.platformCertStore) {
      return 'platform-cert';
    }
    return 'none';
  }

  /**
   * 依据应答/回调头部的 serial 解析验签公钥
   *
   * @param serial `Wechatpay-Serial` 头取值
   * @throws 凭据缺失或 serial 无法匹配时抛错，由驱动层转译为 WepayException
   */
  async resolve(serial: string | undefined): Promise<KeyObject> {
    if (this.publicKeyStore) {
      const key = this.publicKeyStore.resolve(serial);
      if (key) {
        return key;
      }
      throw new Error(`微信支付公钥 ID 不匹配（应答 serial=${serial ?? '缺失'}，已配置=${this.publicKeyStore.keyId}）`);
    }

    if (this.platformCertStore && serial) {
      const key = await this.platformCertStore.resolve(serial);
      if (key) {
        return key;
      }
    }

    throw new Error(`无法解析微信支付验签凭据（serial=${serial ?? '缺失'}，模式=${this.mode}）`);
  }

  /** 平台证书最早到期时间，公钥模式恒为 undefined */
  earliestExpireTime(): string | undefined {
    return this.platformCertStore?.earliestExpireTime();
  }
}

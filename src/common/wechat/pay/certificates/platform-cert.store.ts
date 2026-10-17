import type { KeyObject } from 'node:crypto';

import type { Logger } from '@nestjs/common';

import { decryptAesGcmResource } from '../crypto/cipher';
import { loadPublicKey } from '../crypto/verifier';
import {
  WEPAY_API_PATHS,
  WEPAY_PLATFORM_CERT_FORCE_REFRESH_MIN_INTERVAL_MS,
  WEPAY_PLATFORM_CERT_TTL_MS,
} from '../wepay.constants';

/** 已签名 GET 请求的最小契约：由 real 驱动注入，避免与驱动形成循环依赖 */
export type SignedGetRequest = (path: string, query?: Record<string, string>) => Promise<string>;

/** `/v3/certificates` 应答结构 */
interface PlatformCertificatesResponse {
  data?: {
    serial_no: string;
    effective_time?: string;
    expire_time?: string;
    encrypt_certificate: {
      algorithm: string;
      nonce: string;
      associated_data?: string;
      ciphertext: string;
    };
  }[];
}

/** 平台证书缓存项 */
interface CachedCertificate {
  key: KeyObject;
  expireTime: string;
}

/** 平台证书存储器依赖 */
export interface PlatformCertificateStoreDeps {
  /** 已完成签名与错误转译的 GET 请求器 */
  request: SignedGetRequest;
  /** APIv3 密钥，用于解密证书密文 */
  apiV3Key: string;
  logger: Logger;
  /** 缓存有效期，默认 12 小时 */
  ttlMs?: number;
}

/**
 * 微信支付平台证书存储器（存量商户模式）
 *
 * 通过 `/v3/certificates` 拉取平台证书列表（证书本身以 AES-256-GCM 加密下发），
 * 解密后按 serial_no 建索引缓存；采用 **惰性刷新**（TTL 过期或目标 serial 缺失时拉取），
 * 避免额外引入定时任务，同时在并发场景下复用同一刷新 Promise 防止击穿。
 *
 * 拉取路径**刻意不自带重试**：失败会直接体现为「本次验签或调用失败」，而两条调用链的外层
 * 都已具备重试语义 —— 回调失败时微信会持续重投直到收到 200，出站调用失败则由业务侧重试。
 * 在这一环再叠一层重试只会拉长回调响应时间，收益与上层重试重复。
 */
export class PlatformCertificateStore {
  private readonly cache = new Map<string, CachedCertificate>();
  private readonly ttlMs: number;
  private refreshedAt = 0;
  private lastForcedRefreshAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(private readonly deps: PlatformCertificateStoreDeps) {
    this.ttlMs = deps.ttlMs ?? WEPAY_PLATFORM_CERT_TTL_MS;
  }

  /**
   * 按 serial 解析验签公钥
   *
   * 缓存为空属于首次加载，走常规拉取；**已有缓存却未命中**则说明平台证书可能已轮转，
   * 需强制刷新一次以突破 TTL 早退，否则新证书在最长 12 小时内都无法参与验签。
   * 强刷受最小间隔约束，避免伪造 serial 的回调把本服务变成证书拉取的放大器。
   */
  async resolve(serial: string): Promise<KeyObject | null> {
    const cached = this.cache.get(serial);
    if (cached) {
      return cached.key;
    }

    const force = this.cache.size > 0 && this.canForceRefresh();
    await this.refresh({ force });
    return this.cache.get(serial)?.key ?? null;
  }

  /**
   * 在 TTL 窗口内主动确保缓存新鲜（不突破 TTL，也不受强刷最小间隔约束）
   *
   * **注意：健康检查刻意不调用本方法。** 支付健康指标只做本地校验、不得发起外部请求，
   * 因此本方法当前没有生产调用点 —— 它服务于预热场景与 TTL 行为的单元验证。
   */
  async ensureFresh(): Promise<void> {
    await this.refresh({});
  }

  /** 是否允许触发强制刷新（保证两次强刷之间的最小间隔） */
  private canForceRefresh(): boolean {
    return Date.now() - this.lastForcedRefreshAt >= WEPAY_PLATFORM_CERT_FORCE_REFRESH_MIN_INTERVAL_MS;
  }

  /** 缓存中最早到期的证书时间，用于健康检查预警 */
  earliestExpireTime(): string | undefined {
    const times = [...this.cache.values()].map((item) => item.expireTime).filter((time) => Boolean(time));
    return times.sort()[0];
  }

  /** 当前已缓存的证书数量 */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 惰性刷新证书缓存；并发调用共享同一 Promise
   *
   * @param options.force 为 true 时忽略 TTL 直接拉取（用于 serial 未命中的证书轮转场景）
   */
  private async refresh(options: { force?: boolean }): Promise<void> {
    const force = options.force === true;
    if (!force && this.cache.size > 0 && Date.now() - this.refreshedAt < this.ttlMs) {
      return;
    }
    if (this.inflight) {
      return this.inflight;
    }
    if (force) {
      this.lastForcedRefreshAt = Date.now();
    }

    this.inflight = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** 实际拉取与解密过程：老缓存尚在时容忍失败，首次拉取失败必须上抛 */
  private async doRefresh(): Promise<void> {
    try {
      const body = await this.deps.request(WEPAY_API_PATHS.CERTIFICATES);
      const parsed = JSON.parse(body) as PlatformCertificatesResponse;
      const entries = parsed.data ?? [];
      if (entries.length === 0) {
        throw new Error('微信支付平台证书列表为空');
      }

      const next = new Map<string, CachedCertificate>();
      for (const item of entries) {
        const pem = decryptAesGcmResource(item.encrypt_certificate, this.deps.apiV3Key);
        next.set(item.serial_no, { key: loadPublicKey(pem), expireTime: item.expire_time ?? '' });
      }

      this.cache.clear();
      for (const [serial, certificate] of next) {
        this.cache.set(serial, certificate);
      }
      this.refreshedAt = Date.now();
      this.deps.logger.debug(`微信支付平台证书已刷新，共 ${this.cache.size} 张`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`微信支付平台证书刷新失败：${message}`);
      if (this.cache.size === 0) {
        throw error;
      }
    }
  }
}

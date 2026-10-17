import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformCertificateStore } from '@/common/wechat/pay/certificates/platform-cert.store';
import { encryptAesGcmResource } from '@/common/wechat/pay/crypto/cipher';

const API_V3_KEY = 'nestforge-mock-api-v3-key'.padEnd(32, '0');
const LOGGER = new Logger('PlatformCertStoreTest');

/** 生成一张可被真实解析的「平台证书」（用 RSA 公钥 PEM 充当证书内容） */
function buildCertificatePem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
}

const CERTIFICATE_PEM = buildCertificatePem();

/** 构造 /v3/certificates 应答体 */
function certificatesBody(serial: string, expireTime = '2030-01-01T00:00:00+08:00'): string {
  return JSON.stringify({
    data: [
      {
        serial_no: serial,
        effective_time: '2026-01-01T00:00:00+08:00',
        expire_time: expireTime,
        encrypt_certificate: encryptAesGcmResource(CERTIFICATE_PEM, API_V3_KEY),
      },
    ],
  });
}

describe('微信支付平台证书存储器', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次解析应拉取并解密证书，命中缓存后不再重复拉取', async () => {
    const request = vi.fn(async () => certificatesBody('SERIAL-A'));
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    expect(await store.resolve('SERIAL-A')).not.toBeNull();
    expect(await store.resolve('SERIAL-A')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.earliestExpireTime()).toBe('2030-01-01T00:00:00+08:00');
  });

  it('serial 未命中应强制刷新以突破 TTL，但受最小间隔约束防止放大攻击', async () => {
    const request = vi.fn(async () => certificatesBody('SERIAL-A'));
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    await store.resolve('SERIAL-A');
    expect(request).toHaveBeenCalledTimes(1);

    // 未知 serial：证书可能已轮转，必须突破 12h TTL 强制刷新
    expect(await store.resolve('SERIAL-ROTATED')).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);

    // 紧接着的更多未知 serial：受最小间隔约束，不再触发拉取
    expect(await store.resolve('SERIAL-FORGED')).toBeNull();
    expect(await store.resolve('SERIAL-FORGED-2')).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ensureFresh 在 TTL 内不重复拉取，TTL 过期后重新拉取', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => certificatesBody('SERIAL-A'));
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER, ttlMs: 1000 });

    await store.ensureFresh();
    await store.ensureFresh();
    expect(request).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    await store.ensureFresh();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('首次拉取失败必须上抛，避免静默进入不可验签状态', async () => {
    const request = vi.fn(async () => {
      throw new Error('certificates unavailable');
    });
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    await expect(store.resolve('SERIAL-A')).rejects.toThrowError('certificates unavailable');
  });

  it('已有缓存时刷新失败应降级为告警并保留旧缓存', async () => {
    let callCount = 0;
    const request = vi.fn(async () => {
      callCount += 1;
      if (callCount > 1) {
        throw new Error('later boom');
      }
      return certificatesBody('SERIAL-A');
    });
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    expect(await store.resolve('SERIAL-A')).not.toBeNull();
    // 强刷失败但旧缓存仍在：不抛错，仅返回未命中
    await expect(store.resolve('SERIAL-ROTATED')).resolves.toBeNull();
    expect(store.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('证书列表为空应视为异常而非静默成功', async () => {
    const request = vi.fn(async () => JSON.stringify({ data: [] }));
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    await expect(store.ensureFresh()).rejects.toThrowError('微信支付平台证书列表为空');
  });

  it('并发解析应共享同一次拉取（防止缓存击穿）', async () => {
    const request = vi.fn(async () => certificatesBody('SERIAL-A'));
    const store = new PlatformCertificateStore({ request, apiV3Key: API_V3_KEY, logger: LOGGER });

    await Promise.all([store.resolve('SERIAL-A'), store.resolve('SERIAL-A'), store.resolve('SERIAL-A')]);

    expect(request).toHaveBeenCalledTimes(1);
  });
});

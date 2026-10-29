import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '@/config/env.validation';

import { DEFAULT_TENANT_ID } from '../dto/iot.dto';

/** 设备凭证校验失败统一文案：绝不区分「设备不存在」与「密钥错误」 */
const INVALID_CREDENTIAL_MESSAGE = '设备凭证无效';

/** 未知设备参与恒定时间比较的哨兵摘要，杜绝通过响应耗时探测设备是否存在 */
const SENTINEL_DIGEST = Buffer.alloc(32);

/** 计算设备凭证摘要：HMAC-SHA256(pepper, `${deviceId}:${deviceSecret}`)，避免明文密钥驻留内存 */
function digestCredential(deviceId: string, deviceSecret: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(`${deviceId}:${deviceSecret}`).digest();
}

/** 拆分 `id:value` 形式的配置条目；空条目、缺少 `:` 或任一侧为空均返回 null */
function splitPairEntry(entry: string): { id: string; value: string } | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf(':');
  const id = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : '';
  const value = separatorIndex > 0 ? trimmed.slice(separatorIndex + 1).trim() : '';
  return id && value ? { id, value } : null;
}

/**
 * 解析设备凭证表 (deviceId:secret，英文逗号分隔) 为「设备 ID → 凭证摘要」映射
 * 非法条目仅告警跳过，不输出任何密钥内容
 */
function parseCredentialTable(raw: string, pepper: string, logger: Logger): Map<string, Buffer> {
  const table = new Map<string, Buffer>();

  for (const entry of raw.split(',')) {
    const parsed = splitPairEntry(entry);
    if (!parsed) {
      if (entry.trim()) logger.warn('忽略 IOT_DEVICE_CREDENTIALS 中的非法条目 (应为 deviceId:secret 格式)');
      continue;
    }

    if (table.has(parsed.id)) {
      logger.warn(`设备凭证表存在重复的 deviceId [${parsed.id}]，以最后一次配置为准`);
    }
    table.set(parsed.id, digestCredential(parsed.id, parsed.value, pepper));
  }

  return table;
}

/**
 * 解析设备租户归属表 (deviceId:tenantId，英文逗号分隔)
 * 租户是**服务端事实**，不得由请求体声明，否则同设备可在任意租户命名空间发布数据
 */
function parseTenantTable(raw: string, logger: Logger): Map<string, string> {
  const table = new Map<string, string>();

  for (const entry of raw.split(',')) {
    const parsed = splitPairEntry(entry);
    if (!parsed) {
      if (entry.trim()) logger.warn('忽略 IOT_DEVICE_TENANTS 中的非法条目 (应为 deviceId:tenantId 格式)');
      continue;
    }
    table.set(parsed.id, parsed.value);
  }

  return table;
}

/**
 * 工业设备接入凭证服务 (一机一密换票)
 *
 * 职责边界：
 * 1. 恒定时间校验设备预置密钥，未知设备与密钥错误返回同一语义；
 * 2. 与业务鉴权密钥域隔离，签发设备 JWT 一律使用独立的 IOT_JWT_SECRET；
 * 3. 密钥缺失时 fail fast（绝不回退到硬编码默认值），避免弱密钥伪造设备身份；
 * 4. 租户归属由服务端注册表 (`IOT_DEVICE_TENANTS`) 决定，不接受调用方自报。
 */
@Injectable()
export class IotDeviceCredentialService {
  private readonly logger = new Logger(IotDeviceCredentialService.name);
  /** deviceId -> 凭证摘要 */
  private readonly credentials: Map<string, Buffer>;
  /** deviceId -> 租户归属（服务端注册表） */
  private readonly tenants: Map<string, string>;
  private readonly pepper: string;
  private readonly jwtSecret: string | null;
  private readonly tokenTtlSeconds: number;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.pepper = configService.get('IOT_DEVICE_PEPPER');
    this.credentials = parseCredentialTable(configService.get('IOT_DEVICE_CREDENTIALS'), this.pepper, this.logger);
    this.tenants = parseTenantTable(configService.get('IOT_DEVICE_TENANTS'), this.logger);
    this.jwtSecret = configService.get('IOT_JWT_SECRET') ?? null;
    this.tokenTtlSeconds = configService.get('IOT_TOKEN_TTL_SECONDS');

    if (this.credentials.size === 0) {
      this.logger.warn('未配置任何工业设备接入凭证 (IOT_DEVICE_CREDENTIALS)，设备换票接口将一律拒绝');
    }
  }

  /**
   * 校验设备预置通信密钥，不通过则抛出 UnauthorizedException
   */
  verifyCredential(deviceId: string, deviceSecret: string): void {
    const expected = this.credentials.get(deviceId);

    // 无论设备是否存在都执行一次恒定时间比较，避免时序侧信道泄露设备注册状态
    const provided = digestCredential(deviceId, deviceSecret, this.pepper);
    const matches = timingSafeEqual(expected ?? SENTINEL_DIGEST, provided);

    if (!expected || !matches) {
      throw new UnauthorizedException(INVALID_CREDENTIAL_MESSAGE);
    }
  }

  /**
   * 获取设备 JWT 签名密钥，未配置时拒绝签发（fail fast）
   */
  requireJwtSecret(): string {
    if (!this.jwtSecret) {
      throw new ServiceUnavailableException('设备接入签名密钥未配置 (IOT_JWT_SECRET)，拒绝签发设备凭据');
    }
    return this.jwtSecret;
  }

  /** 获取设备凭据有效期 (秒) */
  getTokenTtlSeconds(): number {
    return this.tokenTtlSeconds;
  }

  /**
   * 解析设备租户归属：未在注册表登记的设备一律归入 `default`。
   *
   * 调用方（换票 / 指令下发）必须使用本方法，而非请求体或 topic 中的租户字段。
   */
  resolveTenant(deviceId: string): string {
    return this.tenants.get(deviceId) ?? DEFAULT_TENANT_ID;
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.validation';

/** 设备凭证校验失败统一文案：绝不区分「设备不存在」与「密钥错误」 */
const INVALID_CREDENTIAL_MESSAGE = '设备凭证无效';

/** 未知设备参与恒定时间比较的哨兵摘要，杜绝通过响应耗时探测设备是否存在 */
const SENTINEL_DIGEST = Buffer.alloc(32);

/** 计算设备凭证摘要：HMAC-SHA256(pepper, `${deviceId}:${deviceSecret}`)，避免明文密钥驻留内存 */
function digestCredential(deviceId: string, deviceSecret: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(`${deviceId}:${deviceSecret}`).digest();
}

/**
 * 解析设备凭证表 (deviceId:secret，英文逗号分隔) 为「设备 ID → 凭证摘要」映射
 * 非法条目仅告警跳过，不输出任何密钥内容
 */
function parseCredentialTable(raw: string, pepper: string, logger: Logger): Map<string, Buffer> {
  const table = new Map<string, Buffer>();

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    const deviceId = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : '';
    const deviceSecret = separatorIndex > 0 ? trimmed.slice(separatorIndex + 1).trim() : '';

    if (!deviceId || !deviceSecret) {
      logger.warn('忽略 IOT_DEVICE_CREDENTIALS 中的非法条目 (应为 deviceId:secret 格式)');
      continue;
    }

    if (table.has(deviceId)) {
      logger.warn(`设备凭证表存在重复的 deviceId [${deviceId}]，以最后一次配置为准`);
    }
    table.set(deviceId, digestCredential(deviceId, deviceSecret, pepper));
  }

  return table;
}

/**
 * 工业设备接入凭证服务 (一机一密换票)
 *
 * 职责边界：
 * 1. 恒定时间校验设备预置密钥，未知设备与密钥错误返回同一语义；
 * 2. 与业务鉴权密钥域隔离，签发设备 JWT 一律使用独立的 IOT_JWT_SECRET；
 * 3. 密钥缺失时 fail fast（绝不回退到硬编码默认值），避免弱密钥伪造设备身份。
 */
@Injectable()
export class IotDeviceCredentialService {
  private readonly logger = new Logger(IotDeviceCredentialService.name);
  /** deviceId -> 凭证摘要 */
  private readonly credentials: Map<string, Buffer>;
  private readonly pepper: string;
  private readonly jwtSecret: string | null;
  private readonly tokenTtlSeconds: number;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.pepper = configService.get('IOT_DEVICE_PEPPER');
    this.credentials = parseCredentialTable(configService.get('IOT_DEVICE_CREDENTIALS'), this.pepper, this.logger);
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
}

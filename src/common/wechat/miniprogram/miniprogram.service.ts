import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isProductionEnv } from '@/common/constants/app.constants';
import type { EnvConfig } from '@/config/env.validation';
import { RedisService } from '@/database/redis.service';

import { type DecryptUserDataOptions, decryptUserData, type WechatDecryptedData } from './crypto/aes-cbc';
import type { IMiniprogramDriver } from './drivers/miniprogram-driver.interface';
import { MockMiniprogramDriver } from './drivers/mock.driver';
import { RealMiniprogramDriver } from './drivers/real.driver';
import type {
  Code2SessionResult,
  CreatePlainQrCodeInput,
  CreateQrCodeInput,
  CreateUnlimitedQrCodeInput,
  GetPhoneNumberInput,
  MiniprogramDriverHealth,
  MiniprogramDriverName,
  MiniprogramPhoneInfo,
  MiniprogramQrCodeImage,
  MsgSecCheckInput,
  MsgSecCheckResult,
  SendSubscribeMessageInput,
  SessionKeyResult,
} from './interfaces/miniprogram.interface';
import { MINIPROGRAM_DEFAULT_API_BASE, MINIPROGRAM_DEFAULT_TIMEOUT_MS } from './miniprogram.constants';

/**
 * 微信小程序服务端 API 门面服务
 *
 * 负责：
 * 1. 依据 `MINIPROGRAM_DRIVER` 装配 real 或 mock 驱动（未配置凭证时自动降级为 mock）；
 * 2. 生产环境凭证缺失时阻断启动，避免接口静默返回假数据；
 * 3. 对外暴露凭证、登录、手机号、小程序码、内容安全、订阅消息六类接口的统一入口。
 *
 * 本服务只承载「能力」不承载「业务」：openid 与用户账号的绑定、session_key 的持久化、
 * 手机号落库、二维码存储与埋点等均属业务侧职责（如 `features/client/auth`）。
 *
 * `session_key` 是敏感材料（旧版开放数据的解密密钥 + 登录态签名密钥），
 * 调用方**必须**在服务端持久化，严禁下发到前端或写入日志。
 */
@Injectable()
export class MiniprogramService implements OnModuleInit {
  private readonly logger = new Logger(MiniprogramService.name);
  private readonly driver: IMiniprogramDriver;
  private readonly appid: string;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly redisService: RedisService,
  ) {
    this.appid = this.configService.get('MINIPROGRAM_APPID') ?? '';
    this.driver = this.resolveDriver();
  }

  /** 生产环境必须使用真实驱动，否则直接阻断启动 */
  onModuleInit(): void {
    if (isProductionEnv() && this.driver.name !== 'real') {
      throw new Error(
        '生产环境检测到微信小程序降级为 mock 驱动：请完整配置 MINIPROGRAM_APPID / MINIPROGRAM_APPSECRET。' +
          '为避免线上接口静默返回假 openid、假手机号与假小程序码，已阻止应用启动。',
      );
    }
  }

  /** 当前生效的驱动名称 */
  get driverName(): MiniprogramDriverName {
    return this.driver.name;
  }

  /** 当前小程序的 appid（业务侧校验开放数据水印时会用到） */
  get appId(): string {
    return this.appid;
  }

  // ── 接口调用凭据 ────────────────────────────────────────────────────

  /** 获取当前有效的 access_token（多 Pod 共享 Redis 缓存，普通模式下由微信保证幂等） */
  getAccessToken(): Promise<string> {
    return this.driver.getAccessToken();
  }

  /**
   * 强制刷新 access_token
   *
   * 仅在确认凭证失效后调用：官方对强刷有「每天 20 次且间隔 30 秒」的硬限制，
   * 常规续期请依赖 {@link getAccessToken} 的内部缓存逻辑。
   */
  refreshAccessToken(): Promise<string> {
    return this.driver.refreshAccessToken();
  }

  // ── 登录 ────────────────────────────────────────────────────────────

  /** 登录凭证校验：前端 `wx.login` 的 code 换 openid / session_key */
  code2Session(jsCode: string): Promise<Code2SessionResult> {
    return this.driver.code2Session(jsCode);
  }

  /**
   * 校验登录态是否仍然有效
   *
   * 「登录态已失效」是查询的正常答案而非故障，故返回 false 而不抛错；
   * 仅当调用本身失败（凭证失效、频率限制等）时才上抛异常。
   */
  checkSessionKey(openid: string, sessionKey: string): Promise<boolean> {
    return this.driver.checkSessionKey(openid, sessionKey);
  }

  /**
   * 重置登录态
   *
   * 旧 session_key 立即失效，且新密钥只能从本次应答取得，调用方须及时持久化。
   */
  resetUserSessionKey(openid: string, sessionKey: string): Promise<SessionKeyResult> {
    return this.driver.resetUserSessionKey(openid, sessionKey);
  }

  // ── 手机号 ──────────────────────────────────────────────────────────

  /** 手机号快速验证：前端 `getPhoneNumber` 回调的 code 换手机号 */
  getPhoneNumber(input: GetPhoneNumberInput): Promise<MiniprogramPhoneInfo> {
    return this.driver.getPhoneNumber(input);
  }

  /**
   * 解密旧版开放数据（AES-128-CBC）
   *
   * 纯函数能力，不依赖驱动与网络：用于存量客户端回传的 `encryptedData` + `iv`。
   * 新版「手机号快速验证」已改为 code 直换，无需本地解密。
   *
   * `expectedAppid` 缺省时自动使用当前小程序 appid 校验数据水印，
   * 阻断跨小程序的密文重放。
   */
  decryptUserData(
    sessionKey: string,
    encryptedData: string,
    iv: string,
    options: DecryptUserDataOptions = {},
  ): WechatDecryptedData {
    return decryptUserData(sessionKey, encryptedData, iv, {
      expectedAppid: this.appid || undefined,
      ...options,
    });
  }

  // ── 小程序码 / 小程序二维码 ─────────────────────────────────────────

  /** 获取不限制的小程序码（数量无限制，业务二维码首选） */
  createUnlimitedQrCode(input: CreateUnlimitedQrCodeInput): Promise<MiniprogramQrCodeImage> {
    return this.driver.createUnlimitedQrCode(input);
  }

  /** 获取小程序码（总量限 10 万个，适用于码数量较少的场景） */
  createQrCode(input: CreateQrCodeInput): Promise<MiniprogramQrCodeImage> {
    return this.driver.createQrCode(input);
  }

  /** 获取小程序二维码（总量限 10 万个，无圆形码外观） */
  createPlainQrCode(input: CreatePlainQrCodeInput): Promise<MiniprogramQrCodeImage> {
    return this.driver.createPlainQrCode(input);
  }

  // ── 内容安全 ────────────────────────────────────────────────────────

  /**
   * 文本内容安全识别
   *
   * 结论以返回值的 `suggest` / `pass` 表达（2.0 起违规不再体现为错误码），
   * 故调用方**必须**读取返回值判定，不能仅以「未抛异常」视为通过。
   */
  checkText(input: MsgSecCheckInput): Promise<MsgSecCheckResult> {
    return this.driver.checkText(input);
  }

  // ── 订阅消息 ────────────────────────────────────────────────────────

  /**
   * 发送订阅消息
   *
   * 属写操作，内部不重试。用户未订阅（43101）以 409 抛出，属业务可预期分支，
   * 调用方可据 `MiniprogramException.miniprogramCode` 区分处置。
   */
  sendSubscribeMessage(input: SendSubscribeMessageInput): Promise<void> {
    return this.driver.sendSubscribeMessage(input);
  }

  // ── 运维 ────────────────────────────────────────────────────────────

  /** 本地健康状态（不发起外部请求） */
  checkHealth(): MiniprogramDriverHealth {
    return this.driver.checkHealth();
  }

  // ── 私有 ────────────────────────────────────────────────────────────

  /** 依据配置装配驱动；显式指定 real 但凭证缺失时直接阻断启动 */
  private resolveDriver(): IMiniprogramDriver {
    if (this.configService.get('MINIPROGRAM_DRIVER') === 'real') {
      return this.createRealDriver();
    }
    return this.createMockDriver();
  }

  /**
   * 装配真实驱动
   *
   * access_token 缓存直接复用全局 `RedisService`：它同时提供 `get` / `set` 与分布式互斥执行，
   * 在结构上即满足驱动所需的缓存契约，使多 Pod 共享同一凭证并避免并发击穿。
   */
  private createRealDriver(): IMiniprogramDriver {
    this.logger.log('微信小程序驱动：real');
    return new RealMiniprogramDriver({
      appid: this.configService.get('MINIPROGRAM_APPID') ?? '',
      appSecret: this.configService.get('MINIPROGRAM_APPSECRET') ?? '',
      apiBase: this.configService.get('MINIPROGRAM_API_BASE') || MINIPROGRAM_DEFAULT_API_BASE,
      timeoutMs: this.configService.get('MINIPROGRAM_TIMEOUT_MS') || MINIPROGRAM_DEFAULT_TIMEOUT_MS,
      tokenCache: this.redisService,
      tokenSafetyWindowSeconds: this.configService.get('MINIPROGRAM_ACCESS_TOKEN_SAFETY_WINDOW_SECONDS'),
      logger: this.logger,
    });
  }

  /** 装配 mock 驱动：未配置凭证时的本地与测试降级 */
  private createMockDriver(): IMiniprogramDriver {
    return new MockMiniprogramDriver({
      appid: this.configService.get('MINIPROGRAM_APPID') || 'mock-miniprogram-appid',
      logger: this.logger,
    });
  }
}

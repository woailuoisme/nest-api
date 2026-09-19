import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProductionEnv } from '@/common/constants/app.constants';
import type { EnvConfig } from '@/config/env.validation';
import { loadPrivateKey } from './crypto/signer';
import { MockWepayDriver } from './drivers/mock.driver';
import { RealWepayDriver } from './drivers/real.driver';
import type { IWepayDriver, WepayMockNotifyMessage } from './drivers/wepay-driver.interface';
import type {
  AppResult,
  CreateAppInput,
  CreateH5Input,
  CreateJsapiInput,
  CreateNativeInput,
  H5Result,
  JsapiResult,
  NativeResult,
  WepayDriverHealth,
  WepayDriverName,
  WepayFundFlowBillInput,
  WepayMockNotifyInput,
  WepayNotifyHeaders,
  WepayNotifyPayload,
  WepayNotifyResource,
  WepayRefundInput,
  WepayRefundResult,
  WepayTradeBillInput,
  WepayTransactionResult,
} from './interfaces/wepay.interface';
import { WEPAY_DEFAULT_API_BASE, WEPAY_DEFAULT_TIMEOUT_MS } from './wepay.constants';
import { WepayException } from './wepay.exception';

/** mock 驱动固定 APIv3 密钥：补齐至 32 字节以满足 AES-256 要求 */
const MOCK_API_V3_KEY = 'nestforge-mock-api-v3-key'.padEnd(32, '0');

/** mock 驱动占位商户标识 */
const MOCK_APPID = 'mock-appid';
const MOCK_MCHID = 'mock-mchid';

/**
 * 微信支付核心门面服务
 *
 * 负责：
 * 1. 依据 `WEPAY_DRIVER` 装配 real 或 mock 驱动（未配置凭证时自动降级为 mock）；
 * 2. 生产环境凭证缺失时阻断启动，避免静默 mock 造成资损；
 * 3. 对外暴露下单、查询、关单、退款、账单与回调验签解密的统一入口。
 *
 * 本服务不承载任何业务语义与持久化：`out_trade_no` 由调用方提供，
 * 回调的幂等、落库与事件发布由业务侧（`features/client/payments`）负责。
 */
@Injectable()
export class WepayService implements OnModuleInit {
  private readonly logger = new Logger(WepayService.name);
  private readonly driver: IWepayDriver;

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    this.driver = this.resolveDriver();
  }

  /** 生产环境必须使用真实驱动，否则直接阻断启动 */
  onModuleInit(): void {
    if (isProductionEnv() && this.driver.name !== 'real') {
      throw new Error(
        '生产环境检测到微信支付降级为 mock 驱动：请完整配置 WEPAY_APPID / WEPAY_MCHID / WEPAY_SERIAL_NO / ' +
          'WEPAY_PRIVATE_KEY(/PATH) / WEPAY_APIV3_KEY。为避免资金风险，已阻止应用启动。',
      );
    }
  }

  /** 当前生效的驱动名称 */
  get driverName(): WepayDriverName {
    return this.driver.name;
  }

  // ── 下单 ────────────────────────────────────────────────────────────

  /** Native 扫码下单 */
  createNative(input: CreateNativeInput): Promise<NativeResult> {
    return this.driver.createNative(input);
  }

  /** JSAPI（公众号/小程序）下单 */
  createJsapi(input: CreateJsapiInput): Promise<JsapiResult> {
    return this.driver.createJsapi(input);
  }

  /** H5 下单 */
  createH5(input: CreateH5Input): Promise<H5Result> {
    return this.driver.createH5(input);
  }

  /** App 下单 */
  createApp(input: CreateAppInput): Promise<AppResult> {
    return this.driver.createApp(input);
  }

  // ── 查询 ────────────────────────────────────────────────────────────

  /** 按商户订单号查询订单 */
  queryByOutTradeNo(outTradeNo: string): Promise<WepayTransactionResult> {
    return this.driver.queryByOutTradeNo(outTradeNo);
  }

  /** 按微信支付订单号查询订单 */
  queryByTransactionId(transactionId: string): Promise<WepayTransactionResult> {
    return this.driver.queryByTransactionId(transactionId);
  }

  /** 按商户退款单号查询退款 */
  queryRefund(outRefundNo: string): Promise<WepayRefundResult> {
    return this.driver.queryRefund(outRefundNo);
  }

  /** 下载交易账单原文 */
  downloadTradeBill(input: WepayTradeBillInput): Promise<string> {
    return this.driver.downloadTradeBill(input);
  }

  /** 下载资金账单原文 */
  downloadFundFlowBill(input: WepayFundFlowBillInput): Promise<string> {
    return this.driver.downloadFundFlowBill(input);
  }

  // ── 写操作 ──────────────────────────────────────────────────────────

  /** 关闭订单 */
  close(outTradeNo: string): Promise<void> {
    return this.driver.close(outTradeNo);
  }

  /** 申请退款 */
  refund(input: WepayRefundInput): Promise<WepayRefundResult> {
    return this.driver.refund(input);
  }

  // ── 回调支撑 ────────────────────────────────────────────────────────

  /** 仅校验回调签名与时间戳新鲜度 */
  verifyNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<void> {
    return this.driver.verifyNotify(headers, rawBody);
  }

  /**
   * 解密回调 `resource` 密文，返回业务资源原文
   *
   * 与 {@link verifyAndDecryptNotify} 的分工：后者是常规入口（验签 + 解密一步到位），
   * 本方法供**已自行完成验签**、或需对已有密文重新解密的场合单独调用 —— 调用方须自行保证
   * 密文来自可信来源，否则等于绕过验签。
   */
  decryptNotifyResource(resource: WepayNotifyResource): Record<string, unknown> {
    return this.driver.decryptNotifyResource(resource);
  }

  /** 验签并解密回调，返回可信业务载荷 */
  verifyAndDecryptNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<WepayNotifyPayload> {
    return this.driver.verifyAndDecryptNotify(headers, rawBody);
  }

  // ── 工具与运维 ──────────────────────────────────────────────────────

  /**
   * 生成商户订单号：`前缀 + yyyyMMddHHmmss + 6 位随机数`，共 22 字符（满足微信 6~32 约束）
   *
   * 仅供业务侧按需选用；`out_trade_no` 的最终归属仍由调用方决定。
   */
  buildOutTradeNo(prefix = 'WP'): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('');
    return `${prefix}${stamp}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  }

  /** 产出签名合法的模拟回调报文（仅 mock 驱动可用） */
  mockIssueNotify(input: WepayMockNotifyInput): WepayMockNotifyMessage {
    if (!this.driver.issueNotify) {
      throw new WepayException('WEPAY_MOCK_ONLY', '仅 mock 驱动支持产出模拟回调报文');
    }
    return this.driver.issueNotify(input);
  }

  /** 本地健康状态（不发起外部请求） */
  checkHealth(): Promise<WepayDriverHealth> {
    return this.driver.checkHealth();
  }

  // ── 私有 ────────────────────────────────────────────────────────────

  /** 依据配置装配驱动；显式指定 real 但凭证缺失时直接阻断启动 */
  private resolveDriver(): IWepayDriver {
    const notifyUrl = this.configService.get('WEPAY_NOTIFY_URL') || undefined;
    if (this.configService.get('WEPAY_DRIVER') === 'real') {
      return this.createRealDriver(notifyUrl);
    }
    return this.createMockDriver(notifyUrl);
  }

  /** 装配真实驱动：私钥不可加载时在启动阶段即抛错，避免运行期才发现配置缺失 */
  private createRealDriver(notifyUrl: string | undefined): IWepayDriver {
    this.logger.log('微信支付驱动：real（直连商户）');
    return new RealWepayDriver({
      appid: this.configService.get('WEPAY_APPID') ?? '',
      mchid: this.configService.get('WEPAY_MCHID') ?? '',
      serialNo: this.configService.get('WEPAY_SERIAL_NO') ?? '',
      privateKey: loadPrivateKey(this.resolvePrivateKeyPem()),
      apiV3Key: this.configService.get('WEPAY_APIV3_KEY') ?? '',
      notifyUrl,
      apiBase: this.configService.get('WEPAY_API_BASE') || WEPAY_DEFAULT_API_BASE,
      timeoutMs: this.configService.get('WEPAY_TIMEOUT_MS') || WEPAY_DEFAULT_TIMEOUT_MS,
      publicKeyPem: this.configService.get('WEPAY_PUBLIC_KEY') || undefined,
      publicKeyId: this.configService.get('WEPAY_PUBLIC_KEY_ID') || undefined,
      logger: this.logger,
    });
  }

  /** 装配 mock 驱动：未配置凭证时的本地与测试降级 */
  private createMockDriver(notifyUrl: string | undefined): IWepayDriver {
    return new MockWepayDriver({
      appid: this.configService.get('WEPAY_APPID') || MOCK_APPID,
      mchid: this.configService.get('WEPAY_MCHID') || MOCK_MCHID,
      apiV3Key: MOCK_API_V3_KEY,
      notifyUrl,
      logger: this.logger,
    });
  }

  /** 解析商户私钥：内联 env 优先，回退文件路径 */
  private resolvePrivateKeyPem(): string {
    const inline = this.configService.get('WEPAY_PRIVATE_KEY');
    if (inline) {
      return inline;
    }

    const keyPath = this.configService.get('WEPAY_PRIVATE_KEY_PATH');
    if (!keyPath) {
      throw new WepayException(
        'WEPAY_PRIVATE_KEY_MISSING',
        '缺少商户私钥：请配置 WEPAY_PRIVATE_KEY 或 WEPAY_PRIVATE_KEY_PATH',
      );
    }

    try {
      return readFileSync(resolve(process.cwd(), keyPath), 'utf8');
    } catch (error) {
      throw new WepayException(
        'WEPAY_PRIVATE_KEY_UNREADABLE',
        `商户私钥文件读取失败（${keyPath}）：${(error as Error).message}`,
      );
    }
  }
}

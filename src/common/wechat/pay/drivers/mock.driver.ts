import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';

import type { Logger } from '@nestjs/common';

import { encryptAesGcmResource } from '../crypto/cipher';
import { randomNonce, signMessage } from '../crypto/signer';
import { buildVerifyMessage } from '../crypto/verifier';
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
  WepayFundFlowBillInput,
  WepayMockNotifyInput,
  WepayNotifyEnvelope,
  WepayNotifyHeaders,
  WepayNotifyPayload,
  WepayNotifyResource,
  WepayRefundInput,
  WepayRefundResult,
  WepayTradeBillInput,
  WepayTradeState,
  WepayTransactionResult,
} from '../interfaces/wepay.interface';
import { buildNotifyPayload, decryptResourcePayload, verifyNotifySignature } from '../notify-verifier';
import { buildAppPayParams, buildJsapiPayParams, type SecondSignContext } from '../second-sign';
import { WEPAY_HEADERS, WEPAY_NOTIFY_TOLERANCE_SECONDS } from '../wepay.constants';
import { WepayException } from '../wepay.exception';
import { assertBillDate, assertRefundInput } from '../wepay.validator';
import type { IWepayDriver, WepayMockNotifyMessage } from './wepay-driver.interface';

/** mock 驱动固定使用的凭据序列号（与微信支付公钥 ID 形态保持一致） */
const MOCK_SERIAL_NO = 'PUB_KEY_ID_MOCK';

/** 驱动器构造参数 */
export interface MockWepayDriverOptions {
  appid: string;
  mchid: string;
  apiV3Key: string;
  notifyUrl?: string;
  logger: Logger;
  notifyToleranceSeconds?: number;
}

/**
 * 微信支付 v3 mock 驱动
 *
 * 用于本地开发与 CI：未配置真实商户凭证时提供确定性假数据，
 * 且验签/解密复用与 real 驱动完全相同的实现（进程内动态生成 RSA 密钥对），
 * 使「下单 → 回调 → 业务处理」全链路可在无真实商户下跑通。
 */
export class MockWepayDriver implements IWepayDriver {
  readonly name = 'mock' as const;

  private readonly appid: string;
  private readonly mchid: string;
  private readonly apiV3Key: string;
  private readonly notifyUrl?: string;
  private readonly notifyToleranceSeconds: number;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly secondSignContext: SecondSignContext;

  /** 订单状态覆盖表，供测试脚本模拟支付完成 */
  private readonly tradeStates = new Map<string, WepayTradeState>();
  /** 退款单记录 */
  private readonly refunds = new Map<string, WepayRefundResult>();

  constructor(options: MockWepayDriverOptions) {
    this.appid = options.appid;
    this.mchid = options.mchid;
    this.apiV3Key = options.apiV3Key;
    this.notifyUrl = options.notifyUrl;
    this.notifyToleranceSeconds = options.notifyToleranceSeconds ?? WEPAY_NOTIFY_TOLERANCE_SECONDS;

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.secondSignContext = { appid: this.appid, mchid: this.mchid, privateKey: this.privateKey };

    options.logger.warn('微信支付运行于 mock 驱动：不会产生真实交易，仅可用于本地开发与测试');
  }

  /** 覆写订单状态，供测试脚本模拟支付成功/关闭等场景 */
  setTradeState(outTradeNo: string, state: WepayTradeState): void {
    this.tradeStates.set(outTradeNo, state);
  }

  // ── 下单 ────────────────────────────────────────────────────────────

  async createNative(input: CreateNativeInput): Promise<NativeResult> {
    const prepayId = this.derivePrepayId(input.outTradeNo);
    return { codeUrl: `weixin://wxpay/bizpayurl?pr=${prepayId.slice(0, 16)}` };
  }

  async createJsapi(input: CreateJsapiInput): Promise<JsapiResult> {
    const prepayId = this.derivePrepayId(input.outTradeNo);
    return { prepayId, payParams: buildJsapiPayParams(this.secondSignContext, prepayId) };
  }

  async createH5(input: CreateH5Input): Promise<H5Result> {
    const prepayId = this.derivePrepayId(input.outTradeNo);
    return { h5Url: `https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=${prepayId}` };
  }

  async createApp(input: CreateAppInput): Promise<AppResult> {
    const prepayId = this.derivePrepayId(input.outTradeNo);
    return { prepayId, payParams: buildAppPayParams(this.secondSignContext, prepayId) };
  }

  // ── 查询与账单 ──────────────────────────────────────────────────────

  async queryByOutTradeNo(outTradeNo: string): Promise<WepayTransactionResult> {
    return this.buildTransaction(outTradeNo, this.tradeStates.get(outTradeNo) ?? 'NOTPAY');
  }

  async queryByTransactionId(transactionId: string): Promise<WepayTransactionResult> {
    const outTradeNo =
      [...this.tradeStates.keys()].find((key) => this.buildTransactionId(key) === transactionId) ?? transactionId;
    return this.buildTransaction(outTradeNo, this.tradeStates.get(outTradeNo) ?? 'NOTPAY');
  }

  async queryRefund(outRefundNo: string): Promise<WepayRefundResult> {
    const cached = this.refunds.get(outRefundNo);
    if (!cached) {
      // 使用官方错误码 RESOURCE_NOT_EXISTS，保证 mock 与 real 驱动的错误码语义一致
      throw new WepayException(
        'RESOURCE_NOT_EXISTS',
        `退款单不存在（mock 驱动需先调用 refund 创建，outRefundNo=${outRefundNo}）`,
      );
    }
    return cached;
  }

  async downloadTradeBill(input: WepayTradeBillInput): Promise<string> {
    // 与 real 驱动保持同一日期门禁，避免本地放行生产必然失败的调用
    assertBillDate(input.billDate);
    return (
      `交易时间,公众账号ID,商户号,商户订单号,交易状态\n` +
      `${input.billDate} 00:00:00,${this.appid},${this.mchid},MOCK-ORDER-1,SUCCESS\n`
    );
  }

  async downloadFundFlowBill(input: WepayFundFlowBillInput): Promise<string> {
    assertBillDate(input.billDate);
    return (
      `记账时间,微信支付业务单号,资金流水单号,业务名称,收支类型,收支金额\n` +
      `${input.billDate} 00:00:00,MOCK-FLOW-1,1000001,交易,收入,1.00\n`
    );
  }

  // ── 写操作 ──────────────────────────────────────────────────────────

  async close(outTradeNo: string): Promise<void> {
    this.tradeStates.set(outTradeNo, 'CLOSED');
  }

  async refund(input: WepayRefundInput): Promise<WepayRefundResult> {
    assertRefundInput(input);

    const result = this.buildRefund(input);
    this.refunds.set(input.outRefundNo, result);
    // 全额退款才将交易置为 REFUND，与微信语义保持一致
    if (input.outTradeNo && input.amount.refund >= input.amount.total) {
      this.tradeStates.set(input.outTradeNo, 'REFUND');
    }
    return result;
  }

  // ── 回调支撑 ────────────────────────────────────────────────────────

  /** 使用进程内自签公钥验签 */
  async verifyNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<void> {
    await verifyNotifySignature({
      headers,
      rawBody,
      toleranceSeconds: this.notifyToleranceSeconds,
      resolvePublicKey: (serial) => this.resolveMockPublicKey(serial),
    });
  }

  /** 解密回调 resource：与 real 驱动共用真实 AES-256-GCM 实现 */
  decryptNotifyResource(resource: WepayNotifyResource): Record<string, unknown> {
    return decryptResourcePayload(resource, this.apiV3Key);
  }

  async verifyAndDecryptNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<WepayNotifyPayload> {
    await this.verifyNotify(headers, rawBody);
    return buildNotifyPayload(rawBody, (resource) => this.decryptNotifyResource(resource));
  }

  /** mock 凭据为进程内自签公钥，serial 必须与固定 ID 一致 */
  private resolveMockPublicKey(serial: string | undefined): KeyObject {
    if (serial && serial !== MOCK_SERIAL_NO) {
      throw new WepayException('WEPAY_CERTIFICATE_UNRESOLVED', `mock 驱动凭据 ID 不匹配（serial=${serial}）`);
    }
    return this.publicKey;
  }

  async checkHealth(): Promise<WepayDriverHealth> {
    return {
      status: 'up',
      driver: this.name,
      certificateMode: 'public-key',
      message: 'mock 驱动已启用（进程内自签凭据，不产生真实交易）',
    };
  }

  /**
   * 产出签名合法的回调报文，供本地端到端联调直接投递到回调路由
   */
  issueNotify(input: WepayMockNotifyInput): WepayMockNotifyMessage {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomNonce();
    const envelope: WepayNotifyEnvelope = {
      id: `mock-notify-${Date.now()}`,
      create_time: new Date().toISOString(),
      event_type: input.eventType,
      resource_type: input.resourceType ?? 'encrypt-resource',
      summary: input.summary ?? 'mock 回调',
      resource: encryptAesGcmResource(JSON.stringify(input.resource), this.apiV3Key),
    };
    const body = JSON.stringify(envelope);

    return {
      headers: {
        [WEPAY_HEADERS.TIMESTAMP]: timestamp,
        [WEPAY_HEADERS.NONCE]: nonce,
        [WEPAY_HEADERS.SERIAL]: MOCK_SERIAL_NO,
        [WEPAY_HEADERS.SIGNATURE]: signMessage(buildVerifyMessage(timestamp, nonce, body), this.privateKey),
      },
      body,
    };
  }

  // ── 私有 ────────────────────────────────────────────────────────────

  /** 由订单号确定性派生 prepay_id，保证同一订单可复现 */
  private derivePrepayId(outTradeNo: string): string {
    return `wx${createHash('sha256').update(outTradeNo).digest('hex').slice(0, 32)}`;
  }

  /** 由订单号确定性派生微信支付订单号 */
  private buildTransactionId(outTradeNo: string): string {
    return createHash('sha256').update(`tx:${outTradeNo}`).digest('hex').slice(0, 32);
  }

  private buildTransaction(outTradeNo: string, tradeState: WepayTradeState): WepayTransactionResult {
    return {
      outTradeNo,
      transactionId: this.buildTransactionId(outTradeNo),
      tradeState,
      tradeStateDesc: tradeState === 'SUCCESS' ? '支付成功' : '未支付',
      tradeType: 'NATIVE',
      appid: this.appid,
      mchid: this.mchid,
      amount: { total: 1, payer_total: 1, currency: 'CNY', payer_currency: 'CNY' },
      ...(tradeState === 'SUCCESS' ? { successTime: new Date().toISOString() } : {}),
      raw: { out_trade_no: outTradeNo, trade_state: tradeState },
    };
  }

  private buildRefund(input: WepayRefundInput): WepayRefundResult {
    return {
      outRefundNo: input.outRefundNo,
      refundId: createHash('sha256').update(`rf:${input.outRefundNo}`).digest('hex').slice(0, 32),
      outTradeNo: input.outTradeNo,
      transactionId: input.transactionId ?? (input.outTradeNo ? this.buildTransactionId(input.outTradeNo) : undefined),
      status: 'SUCCESS',
      successTime: new Date().toISOString(),
      amount: {
        total: input.amount.total,
        refund: input.amount.refund,
        currency: input.amount.currency ?? 'CNY',
      },
      raw: { out_refund_no: input.outRefundNo, status: 'SUCCESS' },
    };
  }
}

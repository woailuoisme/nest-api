import type { KeyObject } from 'node:crypto';

import type { Logger } from '@nestjs/common';
import { retry } from 'es-toolkit';

import { buildQueryString } from '@/common/utils/query-string.util';

import { decompressBillFile, verifyBillFileHash } from '../bill-file';
import { WepayCertificateResolver } from '../certificates/certificate-resolver';
import { PlatformCertificateStore } from '../certificates/platform-cert.store';
import { PublicKeyStore } from '../certificates/public-key.store';
import { buildAuthorizationHeader, buildRequestSignMessage, randomNonce, signMessage } from '../crypto/signer';
import { buildVerifyMessage, verifyMessage } from '../crypto/verifier';
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
  WepayNotifyHeaders,
  WepayNotifyPayload,
  WepayNotifyResource,
  WepayPrepayBaseInput,
  WepayRefundInput,
  WepayRefundResult,
  WepayTradeBillInput,
  WepayTransactionResult,
} from '../interfaces/wepay.interface';
import { buildNotifyPayload, decryptResourcePayload, verifyNotifySignature } from '../notify-verifier';
import { buildAppPayParams, buildJsapiPayParams, type SecondSignContext } from '../second-sign';
import {
  WEPAY_API_PATHS,
  WEPAY_BILL_READY_RETRIES,
  WEPAY_BILL_READY_RETRY_DELAY_MS,
  WEPAY_DEFAULT_API_BASE,
  WEPAY_DEFAULT_TIMEOUT_MS,
  WEPAY_HEADERS,
  WEPAY_NOTIFY_TOLERANCE_SECONDS,
  WEPAY_READ_RETRIES,
  WEPAY_READ_RETRY_DELAY_MS,
} from '../wepay.constants';
import { isWepayError, isWepayRetryable, WepayException } from '../wepay.exception';
import { assertBillDate, assertRefundInput } from '../wepay.validator';
import type { IWepayDriver } from './wepay-driver.interface';

/** 微信支付请求 User-Agent 标识 */
const WEPAY_USER_AGENT = 'nestforge-wepay/1.0';

/** 可选字段转字符串：缺失时保持 undefined，避免把 null/undefined 混入业务类型 */
function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** 驱动器构造参数 */
export interface RealWepayDriverOptions {
  /** 直连商户 appid */
  appid: string;
  /** 直连商户号 */
  mchid: string;
  /** 商户 API 证书序列号 */
  serialNo: string;
  /** 商户 API 私钥 */
  privateKey: KeyObject;
  /** APIv3 密钥，用于解密与验签平台证书 */
  apiV3Key: string;
  /** 默认回调地址 */
  notifyUrl?: string;
  /** 微信支付 API 基址 */
  apiBase?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 回调时间戳容差（秒） */
  notifyToleranceSeconds?: number;
  /** 微信支付公钥 PEM，配置后走公钥模式 */
  publicKeyPem?: string;
  /** 微信支付公钥 ID */
  publicKeyId?: string;
  logger: Logger;
}

/** 原始 HTTP 应答（不含业务语义） */
interface RawWepayResponse {
  status: number;
  /** UTF-8 文本视图：用于 JSON 应答与错误体解析 */
  body: string;
  /** 原始字节：用于账单 gzip 等二进制内容 */
  buffer: Buffer;
  headers: { get(name: string): string | null };
}

/** 申请账单应答中的下载凭据 */
interface BillDownloadTicket {
  downloadUrl: string;
  hashType: string;
  hashValue: string;
}

/** 单次请求选项 */
interface WepayRequestOptions {
  body?: unknown;
  query?: Record<string, string | undefined>;
  withAuth?: boolean;
  /** 绝对 URL 覆盖（账单文件下载使用） */
  absoluteUrl?: string;
}

/**
 * 微信支付 v3 真实驱动
 *
 * 基于原生 `fetch` + `node:crypto` 实现，不引入任何第三方 HTTP 客户端：
 * 1. 出站请求按 SHA256withRSA 签名并附带 Authorization 头；
 * 2. 入站应答与回调按 `Wechatpay-Serial` 解析凭据验签（支持公钥与平台证书双模式）；
 * 3. 错误码统一转译为 {@link WepayException} 直抛，交由全局异常过滤器处理；
 * 4. 仅对幂等安全的读操作重试，写操作与回调处理严禁重试。
 */
export class RealWepayDriver implements IWepayDriver {
  readonly name = 'real' as const;

  private readonly appid: string;
  private readonly mchid: string;
  private readonly serialNo: string;
  private readonly privateKey: KeyObject;
  private readonly secondSignContext: SecondSignContext;
  private readonly apiV3Key: string;
  private readonly notifyUrl?: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly notifyToleranceSeconds: number;
  private readonly logger: Logger;
  private readonly platformStore: PlatformCertificateStore | null;
  private readonly resolver: WepayCertificateResolver;

  constructor(options: RealWepayDriverOptions) {
    this.appid = options.appid;
    this.mchid = options.mchid;
    this.serialNo = options.serialNo;
    this.privateKey = options.privateKey;
    this.apiV3Key = options.apiV3Key;
    this.notifyUrl = options.notifyUrl;
    this.apiBase = (options.apiBase ?? WEPAY_DEFAULT_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? WEPAY_DEFAULT_TIMEOUT_MS;
    this.notifyToleranceSeconds = options.notifyToleranceSeconds ?? WEPAY_NOTIFY_TOLERANCE_SECONDS;
    this.logger = options.logger;
    // 二次签名的商户侧上下文固定不变，构造期一次性装配，避免在每次下单时重复拼装
    this.secondSignContext = { appid: this.appid, mchid: this.mchid, privateKey: this.privateKey };

    // 公钥模式优先：配置了公钥则完全无需向微信拉取证书
    const publicKeyStore =
      options.publicKeyPem && options.publicKeyId
        ? new PublicKeyStore(options.publicKeyPem, options.publicKeyId)
        : null;

    this.platformStore = publicKeyStore
      ? null
      : new PlatformCertificateStore({
          request: (path, query) => this.signedRawGet(path, query),
          apiV3Key: this.apiV3Key,
          logger: this.logger,
        });

    this.resolver = new WepayCertificateResolver(publicKeyStore, this.platformStore);
    this.logger.debug(`微信支付驱动已初始化：验签凭据模式=${this.resolver.mode}，基址=${this.apiBase}`);
  }

  // ── 下单 ────────────────────────────────────────────────────────────

  /** Native 扫码下单，返回用于生成二维码的 code_url */
  async createNative(input: CreateNativeInput): Promise<NativeResult> {
    const data = await this.request<{ code_url?: string }>('POST', WEPAY_API_PATHS.NATIVE, {
      body: {
        ...this.buildPrepayPayload(input),
        ...(input.settleInfo ? { settle_info: input.settleInfo } : {}),
      },
    });
    return { codeUrl: this.requireField(data.code_url, 'code_url', WEPAY_API_PATHS.NATIVE) };
  }

  /** JSAPI 下单，返回 prepay_id 与可直接下发给前端的二次签名参数 */
  async createJsapi(input: CreateJsapiInput): Promise<JsapiResult> {
    const data = await this.request<{ prepay_id?: string }>('POST', WEPAY_API_PATHS.JSAPI, {
      body: { ...this.buildPrepayPayload(input), payer: input.payer },
    });
    const prepayId = this.requireField(data.prepay_id, 'prepay_id', WEPAY_API_PATHS.JSAPI);
    return { prepayId, payParams: buildJsapiPayParams(this.secondSignContext, prepayId) };
  }

  /** H5 下单，返回跳转链接 */
  async createH5(input: CreateH5Input): Promise<H5Result> {
    const data = await this.request<{ h5_url?: string }>('POST', WEPAY_API_PATHS.H5, {
      body: { ...this.buildPrepayPayload(input), scene_info: input.sceneInfo },
    });
    return { h5Url: this.requireField(data.h5_url, 'h5_url', WEPAY_API_PATHS.H5) };
  }

  /** App 下单，返回 prepay_id 与移动端 SDK 所需参数 */
  async createApp(input: CreateAppInput): Promise<AppResult> {
    const data = await this.request<{ prepay_id?: string }>('POST', WEPAY_API_PATHS.APP, {
      body: this.buildPrepayPayload(input),
    });
    const prepayId = this.requireField(data.prepay_id, 'prepay_id', WEPAY_API_PATHS.APP);
    return { prepayId, payParams: buildAppPayParams(this.secondSignContext, prepayId) };
  }

  // ── 查询（幂等安全，接入重试） ────────────────────────────────────────

  /** 按商户订单号查询订单 */
  async queryByOutTradeNo(outTradeNo: string): Promise<WepayTransactionResult> {
    return this.withReadRetry(async () => {
      const data = await this.request<Record<string, unknown>>(
        'GET',
        WEPAY_API_PATHS.TRANSACTION_BY_OUT_TRADE_NO(outTradeNo),
        { query: { mchid: this.mchid } },
      );
      return this.parseTransaction(data);
    });
  }

  /** 按微信支付订单号查询订单 */
  async queryByTransactionId(transactionId: string): Promise<WepayTransactionResult> {
    return this.withReadRetry(async () => {
      const data = await this.request<Record<string, unknown>>(
        'GET',
        WEPAY_API_PATHS.TRANSACTION_BY_ID(transactionId),
        {
          query: { mchid: this.mchid },
        },
      );
      return this.parseTransaction(data);
    });
  }

  /** 按商户退款单号查询退款 */
  async queryRefund(outRefundNo: string): Promise<WepayRefundResult> {
    return this.withReadRetry(async () => {
      const data = await this.request<Record<string, unknown>>(
        'GET',
        WEPAY_API_PATHS.REFUND_BY_OUT_REFUND_NO(outRefundNo),
      );
      return this.parseRefund(data);
    });
  }

  /** 下载交易账单，返回账单文件 CSV 原文 */
  async downloadTradeBill(input: WepayTradeBillInput): Promise<string> {
    assertBillDate(input.billDate);
    const ticket = await this.fetchBillDownloadTicket(WEPAY_API_PATHS.TRADE_BILL, '交易账单', {
      bill_date: input.billDate,
      bill_type: input.billType,
      ...(input.tarType ? { tar_type: input.tarType } : {}),
    });
    return this.downloadBillFile(ticket, input.tarType);
  }

  /** 下载资金账单，返回账单文件 CSV 原文 */
  async downloadFundFlowBill(input: WepayFundFlowBillInput): Promise<string> {
    assertBillDate(input.billDate);
    const ticket = await this.fetchBillDownloadTicket(WEPAY_API_PATHS.FUND_FLOW_BILL, '资金账单', {
      bill_date: input.billDate,
      account_type: input.accountType,
      ...(input.tarType ? { tar_type: input.tarType } : {}),
    });
    return this.downloadBillFile(ticket, input.tarType);
  }

  /**
   * 申请账单并取得下载凭据
   *
   * 外层为「账单生成中」的长间隔退避（覆盖刚过生成时刻但尚未落盘的窗口，跨天等待仍交业务侧调度），
   * 内层为通用读操作重试（覆盖瞬态网络与系统异常）。两层策略互不干扰：
   * `STATEMENT_CREATING` 属业务状态类，不会被内层误判为可重试。
   *
   * 官方应答固定包含 `hash_type` / `hash_value` / `download_url`，后两者缺失无法校验与下载，故按应答异常上报。
   */
  private async fetchBillDownloadTicket(
    path: string,
    billName: string,
    query: Record<string, string>,
  ): Promise<BillDownloadTicket> {
    return this.withBillReadyWait(async () => {
      const data = await this.withReadRetry(() =>
        this.request<{ hash_type?: string; hash_value?: string; download_url?: string }>('GET', path, { query }),
      );

      if (!data.download_url) {
        // 官方在账单未生成时返回 NO_STATEMENT_EXIST / STATEMENT_CREATING（均为 400），此处保持同一状态语义
        throw new WepayException('WEPAY_BILL_NOT_READY', `${billName}尚未生成（微信规则：当日账单需次日 10 点后生成）`);
      }

      return {
        downloadUrl: data.download_url,
        hashType: this.requireField(data.hash_type, 'hash_type', path),
        hashValue: this.requireField(data.hash_value, 'hash_value', path),
      };
    });
  }

  /** 账单就绪等待：仅对「生成中 / 尚未生成」做固定长间隔退避，其余错误立即上抛 */
  private async withBillReadyWait<T>(operation: () => Promise<T>): Promise<T> {
    return retry(operation, {
      retries: WEPAY_BILL_READY_RETRIES,
      delay: WEPAY_BILL_READY_RETRY_DELAY_MS,
      shouldRetry: (error) =>
        isWepayError(error) && (error.wepayCode === 'STATEMENT_CREATING' || error.wepayCode === 'WEPAY_BILL_NOT_READY'),
    });
  }

  // ── 写操作（严禁重试） ──────────────────────────────────────────────

  /** 关闭订单（仅未支付订单可关闭） */
  async close(outTradeNo: string): Promise<void> {
    await this.request<Record<string, unknown>>('POST', WEPAY_API_PATHS.CLOSE(outTradeNo), {
      body: { mchid: this.mchid },
    });
  }

  /**
   * 申请退款
   *
   * 退款结果通知地址与下单保持同一规则：单次调用覆盖优先，其次回退全局 `WEPAY_NOTIFY_URL`；
   * 两者皆缺时微信不推送退款结果，业务侧需自行通过 {@link queryRefund} 轮询兜底。
   */
  async refund(input: WepayRefundInput): Promise<WepayRefundResult> {
    assertRefundInput(input);

    const data = await this.request<Record<string, unknown>>('POST', WEPAY_API_PATHS.REFUND, {
      body: {
        out_refund_no: input.outRefundNo,
        transaction_id: input.transactionId,
        out_trade_no: input.outTradeNo,
        reason: input.reason,
        notify_url: input.notifyUrl ?? this.notifyUrl,
        funds_account: input.fundsAccount,
        amount: input.amount,
        goods_detail: input.goodsDetail,
      },
    });
    return this.parseRefund(data);
  }

  // ── 回调支撑 ────────────────────────────────────────────────────────

  /**
   * 校验回调签名与时间戳新鲜度（防重放）
   *
   * 失败一律视为不可信输入：签名不符 → 401，时间戳越界 → 400。
   */
  async verifyNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<void> {
    await verifyNotifySignature({
      headers,
      rawBody,
      toleranceSeconds: this.notifyToleranceSeconds,
      resolvePublicKey: (serial) => this.resolveVerificationKey(serial),
    });
  }

  /** 解密回调 resource 密文，返回业务资源原文 */
  decryptNotifyResource(resource: WepayNotifyResource): Record<string, unknown> {
    return decryptResourcePayload(resource, this.apiV3Key);
  }

  /** 验签并解密，返回可信的回调业务载荷 */
  async verifyAndDecryptNotify(headers: WepayNotifyHeaders, rawBody: string): Promise<WepayNotifyPayload> {
    await this.verifyNotify(headers, rawBody);
    return buildNotifyPayload(rawBody, (resource) => this.decryptNotifyResource(resource));
  }

  /**
   * 本地校验健康状态（不发起任何外部请求，避免探针打爆微信接口）
   */
  async checkHealth(): Promise<WepayDriverHealth> {
    const mode = this.resolver.mode;

    if (mode === 'public-key') {
      return { status: 'up', driver: this.name, certificateMode: mode, message: '使用微信支付公钥验签' };
    }
    if (mode === 'none') {
      return { status: 'degraded', driver: this.name, certificateMode: mode, message: '未配置任何验签凭据' };
    }

    const cached = this.platformStore?.size ?? 0;
    if (cached === 0) {
      return {
        status: 'degraded',
        driver: this.name,
        certificateMode: mode,
        message: '平台证书尚未缓存，将在首次调用或回调时自动拉取',
      };
    }

    const expireTime = this.platformStore?.earliestExpireTime();
    const expired = expireTime ? new Date(expireTime).getTime() <= Date.now() : false;
    return {
      status: expired ? 'degraded' : 'up',
      driver: this.name,
      certificateMode: mode,
      ...(expireTime ? { certificateExpireTime: expireTime } : {}),
      message: expired ? '平台证书已过期，将在下次调用时自动刷新' : `平台证书缓存正常（${cached} 张）`,
    };
  }

  // ── 私有：请求与签名 ────────────────────────────────────────────────

  /** 发起已签名请求、转译错误码并校验应答签名 */
  private async request<T>(method: 'GET' | 'POST', urlPath: string, options: WepayRequestOptions = {}): Promise<T> {
    const response = await this.rawRequest(method, urlPath, { ...options, withAuth: true });

    if (response.status >= 400) {
      this.throwApiError(response);
    }

    await this.verifyResponseSignature(urlPath, response);

    if (!response.body) {
      return {} as T;
    }
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new WepayException('WEPAY_INVALID_RESPONSE', '微信支付应答体不是合法 JSON');
    }
  }

  /** 平台证书拉取专用的已签名 GET：跳过应答验签以解开凭据自举问题 */
  private async signedRawGet(path: string, query?: Record<string, string>): Promise<string> {
    const response = await this.rawRequest('GET', path, { query, withAuth: true });
    if (response.status >= 400) {
      this.throwApiError(response);
    }
    return response.body;
  }

  /** 将微信错误应答转译为领域异常（透传 request-id 便于向微信追查） */
  private throwApiError(response: RawWepayResponse): never {
    throw WepayException.fromApiError(
      response.status,
      response.body,
      response.headers.get(WEPAY_HEADERS.REQUEST_ID) ?? undefined,
    );
  }

  /** 底层 HTTP 调用：按微信 v3 规范签名并附加 Authorization 头 */
  private async rawRequest(
    method: 'GET' | 'POST',
    urlPath: string,
    options: WepayRequestOptions = {},
  ): Promise<RawWepayResponse> {
    const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
    const queryString = buildQueryString(options.query);
    const signedPath = `${urlPath}${queryString}`;
    const url = options.absoluteUrl ?? `${this.apiBase}${signedPath}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': WEPAY_USER_AGENT,
    };
    if (bodyText) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.withAuth) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = randomNonce();
      const signature = signMessage(
        buildRequestSignMessage({ method, urlPath: signedPath, timestamp, nonceStr, body: bodyText }),
        this.privateKey,
      );
      headers.Authorization = buildAuthorizationHeader({
        mchid: this.mchid,
        serialNo: this.serialNo,
        nonceStr,
        timestamp,
        signature,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(bodyText ? { body: bodyText } : {}),
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return { status: response.status, body: buffer.toString('utf8'), buffer, headers: response.headers };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WepayException('WEPAY_TIMEOUT', `微信支付接口请求超时（${this.timeoutMs}ms）`);
      }
      throw new WepayException(
        'WEPAY_NETWORK_ERROR',
        `微信支付接口网络异常：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 校验微信应答签名
   *
   * 证书列表接口存在凭据自举问题（验签须先拿到证书）故跳过；未携带签名头的应答
   * （如部分文件流）不阻断主流程。
   */
  private async verifyResponseSignature(urlPath: string, response: RawWepayResponse): Promise<void> {
    if (urlPath.startsWith(WEPAY_API_PATHS.CERTIFICATES)) {
      return;
    }

    const signature = response.headers.get(WEPAY_HEADERS.SIGNATURE);
    const timestamp = response.headers.get(WEPAY_HEADERS.TIMESTAMP);
    const nonce = response.headers.get(WEPAY_HEADERS.NONCE);
    if (!signature || !timestamp || !nonce) {
      return;
    }

    const publicKey = await this.resolveVerificationKey(response.headers.get(WEPAY_HEADERS.SERIAL) ?? undefined);
    if (!verifyMessage(buildVerifyMessage(timestamp, nonce, response.body), signature, publicKey)) {
      throw new WepayException('WEPAY_RESPONSE_SIGNATURE_INVALID', '微信支付应答验签失败');
    }
  }

  /** 解析验签凭据（应答与回调共用）：凭据缺失或 serial 不匹配时转译为领域异常 */
  private async resolveVerificationKey(serial: string | undefined): Promise<KeyObject> {
    try {
      return await this.resolver.resolve(serial);
    } catch (error) {
      throw new WepayException('WEPAY_CERTIFICATE_UNRESOLVED', (error as Error).message);
    }
  }

  /**
   * 下载账单文件
   *
   * 官方要求对 `download_url` 的 path + query 按 APIv3 标准签名后携带 Authorization 请求；
   * 下载完成后先按 `tar_type` 解压，再以应答中的 `hash_value` 校验文件完整性。
   */
  private async downloadBillFile(ticket: BillDownloadTicket, tarType?: 'GZIP'): Promise<string> {
    return this.withReadRetry(async () => {
      const response = await this.rawRequest('GET', this.extractSignedPath(ticket.downloadUrl), {
        absoluteUrl: ticket.downloadUrl,
        withAuth: true,
      });
      if (response.status >= 400) {
        // 官方在下载地址过期或请求方与申请方不一致时返回 400 INVALID_REQUEST / 403 NO_AUTH
        this.throwApiError(response);
      }

      const content = decompressBillFile(response.buffer, tarType);
      verifyBillFileHash(content, ticket.hashType, ticket.hashValue);
      return content.toString('utf8');
    });
  }

  /** 从 download_url 提取签名所需的 path + query（官方示例取 getRawPath + getRawQuery） */
  private extractSignedPath(downloadUrl: string): string {
    const parsed = new URL(downloadUrl);
    return `${parsed.pathname}${parsed.search}`;
  }

  /** 查询类操作的受控重试：仅可重试类错误（微信侧系统异常、频率限制、网络与网关故障）参与重试 */
  private async withReadRetry<T>(operation: () => Promise<T>): Promise<T> {
    return retry(operation, {
      retries: WEPAY_READ_RETRIES,
      delay: (attempt) => (attempt + 1) * WEPAY_READ_RETRY_DELAY_MS,
      shouldRetry: (error) => isWepayRetryable(error),
    });
  }

  /**
   * 断言应答中的必需字段存在
   *
   * 微信在极端情况下可能返回 2xx 但缺少关键字段（如空体或结构变更），
   * 若放任 undefined 流入业务会演变为难以定位的空指针，此处统一按应答异常上报。
   */
  private requireField<T>(value: T | undefined, field: string, apiPath?: string): T {
    if (value === undefined || value === null || value === '') {
      throw new WepayException(
        'WEPAY_INVALID_RESPONSE',
        `微信支付应答缺少必需字段 ${field}${apiPath ? `（${apiPath}）` : ''}`,
      );
    }
    return value;
  }

  // ── 私有：载荷构造 ──────────────────────────────────────────────────

  /** 构造下单公共载荷（undefined 字段由 JSON.stringify 自动剔除） */
  private buildPrepayPayload(input: WepayPrepayBaseInput): Record<string, unknown> {
    return {
      appid: this.appid,
      mchid: this.mchid,
      description: input.description,
      out_trade_no: input.outTradeNo,
      time_expire: input.timeExpire,
      attach: input.attach,
      notify_url: this.resolveNotifyUrl(input.notifyUrl),
      goods_tag: input.goodsTag,
      amount: input.amount,
      detail: input.detail,
    };
  }

  /** 解析回调地址：单次调用覆盖优先，其次回退全局配置 */
  private resolveNotifyUrl(override?: string): string {
    const notifyUrl = override ?? this.notifyUrl;
    if (!notifyUrl) {
      throw new WepayException(
        'WEPAY_NOTIFY_URL_MISSING',
        '缺少回调地址：请配置 WEPAY_NOTIFY_URL 或在调用时传入 notifyUrl',
      );
    }
    return notifyUrl;
  }

  /**
   * 解析订单查询应答
   *
   * `out_trade_no` 与 `trade_state` 为官方必填字段：前者是业务关联键，后者决定资金语义，
   * 任一缺失都不得猜测默认值（默认成 NOTPAY 可能诱导业务重复下单），一律按应答异常上报。
   */
  private parseTransaction(data: Record<string, unknown>): WepayTransactionResult {
    return {
      outTradeNo: this.requireField(data.out_trade_no, 'out_trade_no') as string,
      transactionId: optionalString(data.transaction_id),
      tradeState: this.requireField(data.trade_state, 'trade_state') as WepayTransactionResult['tradeState'],
      tradeStateDesc: optionalString(data.trade_state_desc),
      tradeType: optionalString(data.trade_type),
      successTime: optionalString(data.success_time),
      appid: String(data.appid ?? this.appid),
      mchid: String(data.mchid ?? this.mchid),
      amount: data.amount as WepayTransactionResult['amount'],
      payer: data.payer as WepayTransactionResult['payer'],
      attach: optionalString(data.attach),
      raw: data,
    };
  }

  /** 解析退款应答（`out_refund_no` 与 `status` 为官方必填字段，缺失即视为应答异常） */
  private parseRefund(data: Record<string, unknown>): WepayRefundResult {
    return {
      outRefundNo: this.requireField(data.out_refund_no, 'out_refund_no') as string,
      refundId: optionalString(data.refund_id),
      outTradeNo: optionalString(data.out_trade_no),
      transactionId: optionalString(data.transaction_id),
      status: this.requireField(data.status, 'status') as WepayRefundResult['status'],
      successTime: optionalString(data.success_time),
      amount: data.amount as WepayRefundResult['amount'],
      raw: data,
    };
  }
}

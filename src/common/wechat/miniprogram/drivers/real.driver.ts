import { HttpStatus, type Logger } from '@nestjs/common';
import { retry } from 'es-toolkit';
import { buildQueryString } from '@/common/utils/query-string.util';
import { AccessTokenManager } from '../access-token.manager';
import { buildSessionSignature } from '../crypto/session-signature';
import type {
  Code2SessionResult,
  CreatePlainQrCodeInput,
  CreateQrCodeInput,
  CreateUnlimitedQrCodeInput,
  GetPhoneNumberInput,
  MiniprogramAccessToken,
  MiniprogramContentSuggest,
  MiniprogramDriverHealth,
  MiniprogramPhoneInfo,
  MiniprogramQrCodeImage,
  MsgSecCheckDetail,
  MsgSecCheckInput,
  MsgSecCheckResult,
  SendSubscribeMessageInput,
  SessionKeyResult,
} from '../interfaces/miniprogram.interface';
import {
  MINIPROGRAM_ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
  MINIPROGRAM_API_PATHS,
  MINIPROGRAM_CONTENT_LABELS,
  MINIPROGRAM_CONTENT_SUGGESTS,
  MINIPROGRAM_DEFAULT_API_BASE,
  MINIPROGRAM_DEFAULT_TIMEOUT_MS,
  MINIPROGRAM_LANGS,
  MINIPROGRAM_READ_RETRIES,
  MINIPROGRAM_READ_RETRY_DELAY_MS,
  MINIPROGRAM_SIGN_METHOD,
  MINIPROGRAM_SUBSCRIBE_STATES,
  MINIPROGRAM_SUCCESS_CODE,
} from '../miniprogram.constants';
import { isMiniprogramRetryable, MiniprogramException } from '../miniprogram.exception';
import {
  assertJsCode,
  assertMsgSecCheckInput,
  assertPlainQrCodeInput,
  assertQrCodeInput,
  assertSessionKeyInput,
  assertSubscribeMessageInput,
  assertUnlimitedQrCodeInput,
} from '../miniprogram.validator';
import type { IMiniprogramDriver, MiniprogramTokenCache } from './miniprogram-driver.interface';

/** 小程序请求 User-Agent 标识 */
const MINIPROGRAM_USER_AGENT = 'nestforge-miniprogram/1.0';

/** JSON 对象的起始字节（`{`）与数组起始字节（`[`），用于识别错误应答 */
const JSON_BODY_FIRST_BYTES = new Set([0x7b, 0x5b]);

/** 登录态失效错误码：属于「session_key 是否有效」这一查询的正常答案而非故障 */
const SESSION_INVALID_CODES = new Set(['87007', '87009']);

/** 内容安全合法建议值：由常量表单一来源派生，避免在多处重复枚举 */
const CONTENT_SUGGEST_VALUES: readonly string[] = Object.values(MINIPROGRAM_CONTENT_SUGGESTS);

/** 判定上游返回的 suggest 是否为官方合法值（同时把类型收窄为 MiniprogramContentSuggest） */
function isContentSuggest(value: unknown): value is MiniprogramContentSuggest {
  return typeof value === 'string' && CONTENT_SUGGEST_VALUES.includes(value);
}

/** 驱动器构造参数 */
export interface RealMiniprogramDriverOptions {
  /** 小程序 appid */
  appid: string;
  /** 小程序 AppSecret */
  appSecret: string;
  /** API 基址 */
  apiBase?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** access_token 缓存实现（生产环境注入 RedisService） */
  tokenCache?: MiniprogramTokenCache;
  /** access_token 提前续期窗口（秒） */
  tokenSafetyWindowSeconds?: number;
  logger: Logger;
}

/** 原始 HTTP 应答（不含业务语义） */
interface RawMiniprogramResponse {
  status: number;
  /** UTF-8 文本视图：用于 JSON 应答解析 */
  body: string;
  /** 原始字节：用于小程序码等二进制内容 */
  buffer: Buffer;
  contentType: string;
}

/** 单次请求选项 */
interface MiniprogramRequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** 微信 JSON 应答（errcode 缺省表示成功） */
interface MiniprogramJsonPayload {
  errcode?: number | string;
  errmsg?: string;
  [key: string]: unknown;
}

/**
 * 微信小程序服务端 API 真实驱动
 *
 * 基于原生 `fetch` 实现，不引入任何第三方 HTTP 客户端：
 * 1. 接口调用凭据由 {@link AccessTokenManager} 统一管理（Redis 共享缓存 + 分布式刷新锁）；
 * 2. 小程序接口以「**HTTP 200 + body 内 errcode**」返回业务错误，故以 errcode 为准转译为
 *    {@link MiniprogramException} 直抛，交由全局异常过滤器统一输出；
 * 3. 凭证失效（42001 / 40001 / 40014 / 41001）会**强制刷新一次并重试**，其余错误不重试；
 * 4. 小程序码接口成功返回图片二进制、失败返回 JSON，故按应答首字节判别而非 HTTP 状态码。
 */
export class RealMiniprogramDriver implements IMiniprogramDriver {
  readonly name = 'real' as const;

  private readonly appid: string;
  private readonly appSecret: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly accessToken: AccessTokenManager;

  constructor(options: RealMiniprogramDriverOptions) {
    this.appid = options.appid;
    this.appSecret = options.appSecret;
    this.apiBase = (options.apiBase ?? MINIPROGRAM_DEFAULT_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? MINIPROGRAM_DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;

    this.accessToken = new AccessTokenManager({
      appid: this.appid,
      logger: this.logger,
      fetcher: (forceRefresh) => this.fetchStableToken(forceRefresh),
      ...(options.tokenCache ? { cache: options.tokenCache } : {}),
      ...(options.tokenSafetyWindowSeconds === undefined
        ? {}
        : { safetyWindowSeconds: options.tokenSafetyWindowSeconds }),
    });

    this.logger.debug(`微信小程序驱动已初始化：appid=${this.appid}，基址=${this.apiBase}`);
  }

  // ── 接口调用凭据 ────────────────────────────────────────────────────

  /** 获取 access_token（优先命中缓存） */
  async getAccessToken(): Promise<string> {
    return this.accessToken.getToken();
  }

  /** 强制刷新 access_token */
  async refreshAccessToken(): Promise<string> {
    return this.accessToken.refreshToken();
  }

  // ── 登录 ────────────────────────────────────────────────────────────

  /**
   * 登录凭证校验
   *
   * 该接口以 `appid + secret` 直接鉴权，**不依赖 access_token**；
   * `js_code` 只能使用一次且 5 分钟内有效，故不做重试（重试必然得到 40029，反而掩盖原始错误）。
   */
  async code2Session(jsCode: string): Promise<Code2SessionResult> {
    assertJsCode(jsCode);

    const payload = await this.requestJson<MiniprogramJsonPayload>('GET', MINIPROGRAM_API_PATHS.CODE2_SESSION, {
      query: {
        appid: this.appid,
        secret: this.appSecret,
        js_code: jsCode,
        grant_type: 'authorization_code',
      },
    });

    return {
      openid: this.requireString(payload.openid, 'openid'),
      sessionKey: this.requireString(payload.session_key, 'session_key'),
      ...(payload.unionid ? { unionid: String(payload.unionid) } : {}),
    };
  }

  /**
   * 校验 session_key 是否有效
   *
   * `87007`（session_key 不存在或已过期）与 `87009`（签名无效）是「登录态是否有效」这一查询的
   * **正常答案**而非故障，故返回 false 而不抛错；其余错误（凭证失效、频率限制）照常上抛。
   */
  async checkSessionKey(openid: string, sessionKey: string): Promise<boolean> {
    assertSessionKeyInput(openid, sessionKey);

    try {
      await this.withReadRetry(() =>
        this.authedJson('GET', MINIPROGRAM_API_PATHS.CHECK_SESSION, {
          query: {
            openid,
            signature: buildSessionSignature(sessionKey),
            sig_method: MINIPROGRAM_SIGN_METHOD,
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof MiniprogramException && SESSION_INVALID_CODES.has(error.miniprogramCode)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 重置 session_key
   *
   * 重置会使旧 session_key 立即失效，且新密钥**只能从本次应答中取得**，
   * 因此网络失败后重试既无法复用结果、又会再次轮换密钥，故不重试。
   */
  async resetUserSessionKey(openid: string, sessionKey: string): Promise<SessionKeyResult> {
    assertSessionKeyInput(openid, sessionKey);

    const payload = await this.authedJson<MiniprogramJsonPayload>('GET', MINIPROGRAM_API_PATHS.RESET_SESSION, {
      query: {
        openid,
        signature: buildSessionSignature(sessionKey),
        sig_method: MINIPROGRAM_SIGN_METHOD,
      },
    });

    return {
      openid: String(payload.openid ?? openid),
      sessionKey: this.requireString(payload.session_key, 'session_key'),
    };
  }

  // ── 手机号 ──────────────────────────────────────────────────────────

  /** 手机号快速验证：code 换手机号（code 一次性、5 分钟有效，故不重试） */
  async getPhoneNumber(input: GetPhoneNumberInput): Promise<MiniprogramPhoneInfo> {
    const payload = await this.authedJson<MiniprogramJsonPayload>('POST', MINIPROGRAM_API_PATHS.PHONE_NUMBER, {
      body: {
        code: input.code,
        ...(input.openid ? { openid: input.openid } : {}),
      },
    });

    const phoneInfo = payload.phone_info as MiniprogramPhoneInfo | undefined;
    return {
      phoneNumber: this.requireString(phoneInfo?.phoneNumber, 'phone_info.phoneNumber'),
      purePhoneNumber: this.requireString(phoneInfo?.purePhoneNumber, 'phone_info.purePhoneNumber'),
      countryCode: this.requireString(phoneInfo?.countryCode, 'phone_info.countryCode'),
      ...(phoneInfo?.watermark ? { watermark: phoneInfo.watermark } : {}),
    };
  }

  // ── 小程序码 / 小程序二维码 ─────────────────────────────────────────

  /** 获取不限制的小程序码（数量无限制，推荐用于业务二维码） */
  async createUnlimitedQrCode(input: CreateUnlimitedQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertUnlimitedQrCodeInput(input);

    return this.withReadRetry(() =>
      this.authedBinary(MINIPROGRAM_API_PATHS.UNLIMITED_QR_CODE, {
        scene: input.scene,
        page: input.page,
        check_path: input.checkPath,
        env_version: input.envVersion,
        width: input.width,
        auto_color: input.autoColor,
        line_color: input.lineColor,
        is_hyaline: input.isHyaline,
      }),
    );
  }

  /** 获取小程序码（总量限 10 万个） */
  async createQrCode(input: CreateQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertQrCodeInput(input);

    return this.withReadRetry(() =>
      this.authedBinary(MINIPROGRAM_API_PATHS.QR_CODE, {
        path: input.path,
        width: input.width,
        auto_color: input.autoColor,
        line_color: input.lineColor,
        is_hyaline: input.isHyaline,
      }),
    );
  }

  /** 获取小程序二维码（总量限 10 万个） */
  async createPlainQrCode(input: CreatePlainQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertPlainQrCodeInput(input);

    return this.withReadRetry(() =>
      this.authedBinary(MINIPROGRAM_API_PATHS.PLAIN_QR_CODE, {
        path: input.path,
        width: input.width,
      }),
    );
  }

  // ── 内容安全 ────────────────────────────────────────────────────────

  /**
   * 文本内容安全识别（2.0）
   *
   * 违规内容在 2.0 中**仍返回 errcode = 0**，是否违规需依据 `result.suggest` 判定
   * （1.0 才以 errcode = 87014 表达）。本方法返回归一化后的 `suggest` / `pass`。
   *
   * 该接口为无副作用的只读检测，接入受控重试。
   */
  async checkText(input: MsgSecCheckInput): Promise<MsgSecCheckResult> {
    assertMsgSecCheckInput(input);

    const payload = await this.withReadRetry(() =>
      this.authedJson<MiniprogramJsonPayload>('POST', MINIPROGRAM_API_PATHS.MSG_SEC_CHECK, {
        body: {
          content: input.content,
          version: 2,
          scene: input.scene,
          openid: input.openid,
          title: input.title,
          nickname: input.nickname,
          signature: input.signature,
        },
      }),
    );

    const result = payload.result as { suggest?: string; label?: number } | undefined;
    const suggest = result?.suggest;

    // 内容审核必须「宁可错杀」：拿不到明确建议时不得默认放行
    if (!isContentSuggest(suggest)) {
      throw new MiniprogramException(
        'MINIPROGRAM_INVALID_RESPONSE',
        `内容安全应答缺少可判定的 result.suggest（实际 ${String(suggest)}），为避免绕过审核已按失败处理`,
      );
    }

    const label = typeof result?.label === 'number' ? result.label : 100;
    return {
      ...(payload.trace_id ? { traceId: String(payload.trace_id) } : {}),
      suggest,
      label,
      ...(MINIPROGRAM_CONTENT_LABELS[label] ? { labelDescription: MINIPROGRAM_CONTENT_LABELS[label] } : {}),
      pass: suggest === MINIPROGRAM_CONTENT_SUGGESTS.PASS,
      detail: Array.isArray(payload.detail) ? (payload.detail as MsgSecCheckDetail[]) : [],
      raw: payload,
    };
  }

  // ── 订阅消息 ────────────────────────────────────────────────────────

  /**
   * 发送订阅消息
   *
   * 属**写操作**：官方在多条并发下发场景会返回 `43108`，重试可能造成用户收到重复消息，
   * 因此无论错误是否可重试都不重试。
   */
  async sendSubscribeMessage(input: SendSubscribeMessageInput): Promise<void> {
    assertSubscribeMessageInput(input);

    await this.authedJson<MiniprogramJsonPayload>('POST', MINIPROGRAM_API_PATHS.SUBSCRIBE_SEND, {
      body: {
        touser: input.touser,
        template_id: input.templateId,
        data: input.data,
        page: input.page,
        miniprogram_state: input.miniprogramState ?? MINIPROGRAM_SUBSCRIBE_STATES.FORMAL,
        lang: input.lang ?? MINIPROGRAM_LANGS.ZH_CN,
      },
    });
  }

  // ── 运维 ────────────────────────────────────────────────────────────

  /** 本地校验健康状态（不发起任何外部请求，避免探针按频率打爆微信接口） */
  checkHealth(): MiniprogramDriverHealth {
    const configured = Boolean(this.appid && this.appSecret);
    return {
      status: configured ? 'up' : 'degraded',
      driver: this.name,
      configured,
      message: configured
        ? '已配置小程序凭证，access_token 将由缓存统一管理'
        : '缺少 MINIPROGRAM_APPID 或 MINIPROGRAM_APPSECRET，接口调用将直接失败',
    };
  }

  // ── 私有：HTTP 与错误转译 ───────────────────────────────────────────

  /** 获取稳定版接口调用凭据（普通模式下有效期内重复调用返回同一凭证） */
  private async fetchStableToken(forceRefresh: boolean): Promise<MiniprogramAccessToken> {
    const payload = await this.withReadRetry(() =>
      this.requestJson<MiniprogramJsonPayload>('POST', MINIPROGRAM_API_PATHS.STABLE_TOKEN, {
        body: {
          grant_type: 'client_credential',
          appid: this.appid,
          secret: this.appSecret,
          ...(forceRefresh ? { force_refresh: true } : {}),
        },
      }),
    );

    const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : undefined;
    if (expiresIn === undefined) {
      this.logger.warn(
        `stable_token 应答未携带有效的 expires_in，按官方默认 ${MINIPROGRAM_ACCESS_TOKEN_DEFAULT_TTL_SECONDS}s 缓存`,
      );
    }

    return {
      accessToken: typeof payload.access_token === 'string' ? payload.access_token : '',
      expiresIn: expiresIn ?? MINIPROGRAM_ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
    };
  }

  /**
   * 携带 access_token 的 JSON 调用
   *
   * 凭证失效（42001 / 40001 / 40014 / 41001）时强制刷新一次并重试 —— 这是 access_token 类接口的
   * 标准容错：凭证可能在缓存续期窗口内被平台提前轮换，重试一次即可恢复，无需让业务感知。
   */
  private async authedJson<T>(method: 'GET' | 'POST', path: string, options: MiniprogramRequestOptions): Promise<T> {
    const token = await this.accessToken.getToken();
    try {
      return await this.requestJson<T>(method, path, this.withToken(options, token));
    } catch (error) {
      const refreshedToken = await this.refreshTokenOrRethrow(error);
      return this.requestJson<T>(method, path, this.withToken(options, refreshedToken));
    }
  }

  /** 携带 access_token 的二进制调用（小程序码），同样具备凭证失效重试 */
  private async authedBinary(path: string, body: Record<string, unknown>): Promise<MiniprogramQrCodeImage> {
    const token = await this.accessToken.getToken();
    try {
      return await this.requestBinary(path, body, token);
    } catch (error) {
      const refreshedToken = await this.refreshTokenOrRethrow(error);
      return this.requestBinary(path, body, refreshedToken);
    }
  }

  /**
   * 凭证失效时强制刷新并返回新凭证；非凭证类错误原样抛出，由统一异常处理接管
   */
  private async refreshTokenOrRethrow(error: unknown): Promise<string> {
    if (!(error instanceof MiniprogramException) || !error.refreshTokenRetryable) {
      throw error;
    }

    this.logger.warn(`微信小程序凭证失效（errcode=${error.miniprogramCode}），强制刷新后重试一次`);
    try {
      return await this.accessToken.refreshToken();
    } catch (refreshError) {
      // 刷新本身失败时，保留原始业务错误更有诊断价值
      this.logger.error(`强制刷新 access_token 失败：${(refreshError as Error).message}`);
      throw error;
    }
  }

  /** 合并 access_token 到查询参数 */
  private withToken(options: MiniprogramRequestOptions, token: string): MiniprogramRequestOptions {
    return { ...options, query: { ...options.query, access_token: token } };
  }

  /** 发起 JSON 调用并统一转译业务错误码 */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    options: MiniprogramRequestOptions = {},
  ): Promise<T> {
    const response = await this.rawRequest(method, path, options);
    const payload = this.tryParseJson(response.body);

    const errcode = payload?.errcode;
    if (errcode !== undefined && errcode !== null && Number(errcode) !== MINIPROGRAM_SUCCESS_CODE) {
      throw MiniprogramException.fromApiError(errcode, payload?.errmsg);
    }

    if (response.status >= 400) {
      throw new MiniprogramException(
        'MINIPROGRAM_HTTP_ERROR',
        `微信小程序接口返回 HTTP ${response.status}${response.body ? `：${response.body.slice(0, 200)}` : ''}`,
        response.status as HttpStatus,
      );
    }

    if (!payload) {
      throw new MiniprogramException('MINIPROGRAM_INVALID_RESPONSE', `微信小程序应答体不是合法 JSON（${path}）`);
    }

    return payload as T;
  }

  /**
   * 解析上游应答体，非 JSON 时返回 null
   *
   * 上游文本一律视为不可信输入：解析失败是**预期内**的分支（网关错误页、空体），
   * 由调用方决定转译为哪一类异常，故此方法绝不抛出。
   */
  private tryParseJson(raw: string): MiniprogramJsonPayload | null {
    try {
      return JSON.parse(raw) as MiniprogramJsonPayload;
    } catch {
      return null;
    }
  }

  /** 发起小程序码调用：成功为图片二进制，失败为 JSON */
  private async requestBinary(
    path: string,
    body: Record<string, unknown>,
    token: string,
  ): Promise<MiniprogramQrCodeImage> {
    const response = await this.rawRequest('POST', path, {
      query: { access_token: token },
      body,
    });

    // 官方约定：失败时返回 JSON（含 errcode/errmsg），成功时直接返回图片字节。
    // 图片格式为 PNG/JPEG，首字节必为魔数，绝不可能以 `{` 或 `[` 开头，
    // 因此以应答首字节判别比依赖 Content-Type 更可靠（部分网关会改写该头）。
    if (JSON_BODY_FIRST_BYTES.has(response.buffer[0] ?? 0)) {
      throw MiniprogramException.fromRawError(response.body);
    }

    if (response.status >= 400) {
      throw new MiniprogramException(
        'MINIPROGRAM_HTTP_ERROR',
        `微信小程序码接口返回 HTTP ${response.status}`,
        response.status as HttpStatus,
      );
    }

    if (response.buffer.length === 0) {
      throw new MiniprogramException('MINIPROGRAM_BINARY_ERROR', '微信小程序码接口返回了空应答体');
    }

    return { buffer: response.buffer, contentType: response.contentType || 'image/jpeg' };
  }

  /** 底层 HTTP 调用：统一超时、网络异常转译 */
  private async rawRequest(
    method: 'GET' | 'POST',
    path: string,
    options: MiniprogramRequestOptions = {},
  ): Promise<RawMiniprogramResponse> {
    const queryString = buildQueryString(options.query);
    const url = `${this.apiBase}${path}${queryString}`;
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': MINIPROGRAM_USER_AGENT,
    };
    if (bodyText) {
      headers['Content-Type'] = 'application/json';
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
      return {
        status: response.status,
        body: buffer.toString('utf8'),
        buffer,
        contentType: response.headers.get('content-type') ?? '',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new MiniprogramException('MINIPROGRAM_TIMEOUT', `微信小程序接口请求超时（${this.timeoutMs}ms）`);
      }
      throw new MiniprogramException(
        'MINIPROGRAM_NETWORK_ERROR',
        `微信小程序接口网络异常：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 受控重试
   *
   * 仅用于**幂等安全且无副作用**的调用：凭证获取（普通模式幂等）、登录态校验、内容检测、小程序码生成。
   * 写操作（发送订阅消息）、一次性凭证消费类（code2Session / getPhoneNumber）与密钥轮换
   * （resetUserSessionKey）一律不接入重试。
   */
  private async withReadRetry<T>(operation: () => Promise<T>): Promise<T> {
    return retry(operation, {
      retries: MINIPROGRAM_READ_RETRIES,
      delay: (attempt) => (attempt + 1) * MINIPROGRAM_READ_RETRY_DELAY_MS,
      shouldRetry: (error) => isMiniprogramRetryable(error),
    });
  }

  /**
   * 断言应答中的必需字符串字段存在
   *
   * 微信在极端情况下可能返回 errcode = 0 但缺少关键字段（如空体或结构变更），
   * 若放任 undefined 流入业务会演变为难以定位的空指针，此处统一按应答异常上报。
   */
  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value === '') {
      throw new MiniprogramException('MINIPROGRAM_INVALID_RESPONSE', `微信小程序应答缺少必需字段 ${field}`);
    }
    return value;
  }
}

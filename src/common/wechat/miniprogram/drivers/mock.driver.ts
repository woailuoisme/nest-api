import { createHash } from 'node:crypto';

import type { Logger } from '@nestjs/common';

import { buildSessionSignature } from '../crypto/session-signature';
import type {
  Code2SessionResult,
  CreatePlainQrCodeInput,
  CreateQrCodeInput,
  CreateUnlimitedQrCodeInput,
  GetPhoneNumberInput,
  MiniprogramContentSuggest,
  MiniprogramDriverHealth,
  MiniprogramPhoneInfo,
  MiniprogramQrCodeImage,
  MsgSecCheckInput,
  MsgSecCheckResult,
  SendSubscribeMessageInput,
  SessionKeyResult,
} from '../interfaces/miniprogram.interface';
import { MINIPROGRAM_CONTENT_LABELS, MINIPROGRAM_CONTENT_SUGGESTS } from '../miniprogram.constants';
import { MiniprogramException } from '../miniprogram.exception';
import {
  assertJsCode,
  assertMsgSecCheckInput,
  assertPlainQrCodeInput,
  assertQrCodeInput,
  assertSessionKeyInput,
  assertSubscribeMessageInput,
  assertUnlimitedQrCodeInput,
} from '../miniprogram.validator';
import type { IMiniprogramDriver } from './miniprogram-driver.interface';

/**
 * 1×1 透明 PNG
 *
 * 前 8 字节即 PNG 魔数（`\x89PNG\r\n\x1a\n`），保证 mock 产出的图片是**结构合法**的图像字节，
 * 使「生成小程序码 → 存储 → 回流」链路上的字节处理逻辑可被完整验证。
 */
const MOCK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

/** mock 判定为违规的内容关键词 */
const MOCK_RISKY_KEYWORDS = ['违规', 'risky', 'badword'] as const;

/** mock 判定为待人工复核的内容关键词 */
const MOCK_REVIEW_KEYWORDS = ['review', '待审'] as const;

/** 驱动器构造参数 */
export interface MockMiniprogramDriverOptions {
  appid: string;
  logger: Logger;
}

/**
 * 微信小程序服务端 API mock 驱动
 *
 * 用于本地开发与 CI：未配置真实小程序凭证时提供**确定性**假数据，
 * 但入参校验、登录态签名计算与返回结构与真实驱动完全一致，
 * 使「登录 → 换取手机号 → 生成小程序码 → 内容安全 → 订阅消息」全链路可在无真实小程序下跑通。
 */
export class MockMiniprogramDriver implements IMiniprogramDriver {
  readonly name = 'mock' as const;

  private readonly appid: string;
  private readonly logger: Logger;

  /** openid → 当前登录态签名（用于校验 session_key 是否仍然有效） */
  private readonly sessionSignatures = new Map<string, string>();
  /** openid → session_key 轮换次数，用于派生出可复现的新密钥 */
  private readonly sessionRotations = new Map<string, number>();

  constructor(options: MockMiniprogramDriverOptions) {
    this.appid = options.appid;
    this.logger = options.logger;
    this.logger.warn('微信小程序运行于 mock 驱动：不会调用真实微信接口，仅可用于本地开发与测试');
  }

  // ── 接口调用凭据 ────────────────────────────────────────────────────

  /** 由 appid 确定性派生凭证，同一 appid 每次返回一致 */
  async getAccessToken(): Promise<string> {
    return `mock-access-token-${this.appid}-${this.hash(this.appid, 16)}`;
  }

  async refreshAccessToken(): Promise<string> {
    return this.getAccessToken();
  }

  // ── 登录 ────────────────────────────────────────────────────────────

  /** 由 jsCode 确定性派生 openid 与 session_key，并登记登录态以便后续校验 */
  async code2Session(jsCode: string): Promise<Code2SessionResult> {
    assertJsCode(jsCode);

    const openid = `mock-openid-${this.hash(jsCode, 28)}`;
    const sessionKey = this.deriveSessionKey(openid, 0);
    this.sessionSignatures.set(openid, buildSessionSignature(sessionKey));

    return { openid, sessionKey };
  }

  /** 校验登录态：签名一致才视为有效，与真实驱动走同一套 HMAC 计算 */
  async checkSessionKey(openid: string, sessionKey: string): Promise<boolean> {
    assertSessionKeyInput(openid, sessionKey);
    return this.isSessionValid(openid, sessionKey);
  }

  /** 重置登录态：旧密钥立即失效，返回派生的新密钥（可复现） */
  async resetUserSessionKey(openid: string, sessionKey: string): Promise<SessionKeyResult> {
    assertSessionKeyInput(openid, sessionKey);

    if (!this.isSessionValid(openid, sessionKey)) {
      throw MiniprogramException.fromApiError(87007, 'session_key is not existd or expired');
    }

    const rotation = (this.sessionRotations.get(openid) ?? 0) + 1;
    this.sessionRotations.set(openid, rotation);

    const nextSessionKey = this.deriveSessionKey(openid, rotation);
    this.sessionSignatures.set(openid, buildSessionSignature(nextSessionKey));
    return { openid, sessionKey: nextSessionKey };
  }

  // ── 手机号 ──────────────────────────────────────────────────────────

  /** 由 code 确定性派生手机号，保证同一 code 的测试结果可复现 */
  async getPhoneNumber(input: GetPhoneNumberInput): Promise<MiniprogramPhoneInfo> {
    const hash = createHash('sha256').update(`phone:${input.code}`).digest();

    // 首字节决定号段第二位，其余字节依次取模得到 9 位尾号，构成 11 位手机号
    const local =
      `1${3 + ((hash[0] ?? 0) % 7)}` +
      Array.from(hash.subarray(1, 10))
        .map((byte) => String(byte % 10))
        .join('');

    return {
      phoneNumber: `86${local}`,
      purePhoneNumber: local,
      countryCode: '86',
      watermark: { timestamp: Math.floor(Date.now() / 1000), appid: this.appid },
    };
  }

  // ── 小程序码 / 小程序二维码 ─────────────────────────────────────────

  async createUnlimitedQrCode(input: CreateUnlimitedQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertUnlimitedQrCodeInput(input);
    return this.mockImage();
  }

  async createQrCode(input: CreateQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertQrCodeInput(input);
    return this.mockImage();
  }

  async createPlainQrCode(input: CreatePlainQrCodeInput): Promise<MiniprogramQrCodeImage> {
    assertPlainQrCodeInput(input);
    return this.mockImage();
  }

  // ── 内容安全 ────────────────────────────────────────────────────────

  /**
   * 内容安全检测：按固定关键词规则判定，使「违规内容拦截」分支可被确定性验证
   *
   * 与真实驱动保持一致：违规时仍返回 errcode = 0，由 `result.suggest` 表达结论。
   */
  async checkText(input: MsgSecCheckInput): Promise<MsgSecCheckResult> {
    assertMsgSecCheckInput(input);

    const suggest = this.resolveContentSuggest(input.content);
    const label = suggest === MINIPROGRAM_CONTENT_SUGGESTS.PASS ? 100 : 21000;

    return {
      traceId: `mock-trace-${this.hash(input.content, 16)}`,
      suggest,
      label,
      ...(MINIPROGRAM_CONTENT_LABELS[label] ? { labelDescription: MINIPROGRAM_CONTENT_LABELS[label] } : {}),
      pass: suggest === MINIPROGRAM_CONTENT_SUGGESTS.PASS,
      detail: [
        {
          strategy: 'mock_rule',
          errcode: 0,
          suggest,
          label,
          prob: suggest === MINIPROGRAM_CONTENT_SUGGESTS.PASS ? 0 : 100,
        },
      ],
      raw: { errcode: 0, errmsg: 'ok', result: { suggest, label } },
    };
  }

  // ── 订阅消息 ────────────────────────────────────────────────────────

  /** 发送订阅消息：mock 场景一律成功，仅做与真实驱动一致的入参校验 */
  async sendSubscribeMessage(input: SendSubscribeMessageInput): Promise<void> {
    assertSubscribeMessageInput(input);
    this.logger.debug(`mock 订阅消息已发送：touser=${input.touser}，templateId=${input.templateId}`);
  }

  // ── 运维 ────────────────────────────────────────────────────────────

  checkHealth(): MiniprogramDriverHealth {
    return {
      status: 'up',
      driver: this.name,
      configured: false,
      message: 'mock 驱动已启用（确定性假数据，不调用真实微信接口）',
    };
  }

  // ── 私有 ────────────────────────────────────────────────────────────

  /** 登录态是否有效：签名与当前登记的登录态一致，即视为持有正确的 session_key */
  private isSessionValid(openid: string, sessionKey: string): boolean {
    return this.sessionSignatures.get(openid) === buildSessionSignature(sessionKey);
  }

  /** 按固定关键词规则推导内容结论 */
  private resolveContentSuggest(content: string): MiniprogramContentSuggest {
    if (MOCK_RISKY_KEYWORDS.some((keyword) => content.includes(keyword))) {
      return MINIPROGRAM_CONTENT_SUGGESTS.RISKY;
    }
    if (MOCK_REVIEW_KEYWORDS.some((keyword) => content.includes(keyword))) {
      return MINIPROGRAM_CONTENT_SUGGESTS.REVIEW;
    }
    return MINIPROGRAM_CONTENT_SUGGESTS.PASS;
  }

  /** 由 openid 与轮换次数派生 session_key（base64 形态与官方一致，解码后 16 字节） */
  private deriveSessionKey(openid: string, rotation: number): string {
    return createHash('sha256').update(`session:${openid}:${rotation}`).digest().subarray(0, 16).toString('base64');
  }

  /** 构造 mock 图片应答：每次返回独立副本，避免调用方修改影响其他调用 */
  private mockImage(): MiniprogramQrCodeImage {
    return { buffer: Buffer.from(MOCK_PNG_BASE64, 'base64'), contentType: 'image/png' };
  }

  /** 取内容摘要的十六进制前缀，用于确定性派生 */
  private hash(input: string, length: number): string {
    return createHash('sha256').update(input).digest('hex').slice(0, length);
  }
}

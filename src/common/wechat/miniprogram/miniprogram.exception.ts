import { HttpException, HttpStatus } from '@nestjs/common';
import {
  MINIPROGRAM_DEFAULT_ERROR_STATUS,
  MINIPROGRAM_ERROR_MAP,
  type MiniprogramErrorCategory,
  type MiniprogramErrorDescriptor,
} from './miniprogram.constants';

/**
 * 查询错误码的处置描述
 *
 * `errcode` 官方为数字（如 `42001`），本模块自定义错误码为 `MINIPROGRAM_*` 字符串，
 * 统一转为字符串键后查表。
 */
export function getMiniprogramErrorDescriptor(
  code: string | number | undefined,
): MiniprogramErrorDescriptor | undefined {
  if (code === undefined || code === null) {
    return undefined;
  }
  return MINIPROGRAM_ERROR_MAP[String(code)];
}

/** 查询错误码的分类（未收录返回 undefined） */
export function getMiniprogramErrorCategory(code: string | number | undefined): MiniprogramErrorCategory | undefined {
  return getMiniprogramErrorDescriptor(code)?.category;
}

/**
 * 解析错误应返回的 HTTP 状态码
 *
 * 小程序接口以 `errcode` 承载业务错误（HTTP 层始终 200），故状态码以映射表为准；
 * 仅当上游返回了真正的 HTTP 错误状态（网关故障等）时优先透传，保证与官方语义一致。
 */
export function resolveMiniprogramErrorStatus(code: string | number | undefined, upstreamStatus?: number): HttpStatus {
  if (upstreamStatus !== undefined && upstreamStatus >= 400 && upstreamStatus <= 599) {
    return upstreamStatus as HttpStatus;
  }
  return getMiniprogramErrorDescriptor(code)?.status ?? MINIPROGRAM_DEFAULT_ERROR_STATUS;
}

/** 小程序错误应答体 */
interface MiniprogramApiErrorBody {
  errcode?: number | string;
  errmsg?: string;
}

/** 安全解析 JSON 文本，失败返回 null */
function safeParseJson(raw: string): MiniprogramApiErrorBody | null {
  try {
    const parsed = JSON.parse(raw) as MiniprogramApiErrorBody;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 微信小程序领域异常
 *
 * 小程序接口全部以「HTTP 200 + body 内 `errcode`」模型返回业务错误，
 * 本异常把 `errcode` 转译为语义化 HTTP 状态，交由全局 `HttpExceptionFilter`
 * 输出统一信封，调用方可据 `miniprogramCode` / `category` 区分处置方式。
 */
export class MiniprogramException extends HttpException {
  constructor(
    /** 微信官方 errcode（如 42001），或本模块自定义的 MINIPROGRAM_* 码 */
    readonly miniprogramCode: string,
    message: string,
    status: HttpStatus = resolveMiniprogramErrorStatus(miniprogramCode),
  ) {
    super({ code: miniprogramCode, message }, status);
  }

  /** 错误分类（未收录的错误码返回 undefined） */
  get category(): MiniprogramErrorCategory | undefined {
    return getMiniprogramErrorCategory(this.miniprogramCode);
  }

  /** 是否可通过强制刷新 access_token 后重试解决 */
  get refreshTokenRetryable(): boolean {
    return getMiniprogramErrorDescriptor(this.miniprogramCode)?.refreshTokenRetryable === true;
  }

  /** 是否可原样重试（微信侧瞬态故障或频率限制） */
  get plainRetryable(): boolean {
    return getMiniprogramErrorDescriptor(this.miniprogramCode)?.plainRetryable === true;
  }

  /**
   * 依据小程序错误应答构造异常
   *
   * 应答体可解析且含 `errcode` 时采用官方错误码与文案；否则降级为携带原始 HTTP 状态的通用错误。
   */
  static fromApiError(
    errcode: number | string,
    errmsg: string | undefined,
    upstreamStatus?: number,
  ): MiniprogramException {
    const code = String(errcode);
    const description = getMiniprogramErrorDescriptor(code)?.description ?? `微信小程序接口调用失败（errcode=${code}）`;

    return new MiniprogramException(
      code,
      errmsg ? `${description}：${errmsg}` : description,
      resolveMiniprogramErrorStatus(code, upstreamStatus),
    );
  }

  /**
   * 从原始应答文本构造异常
   *
   * 用于「HTTP 200 但应答为 JSON 错误」以及二进制接口（小程序码）返回错误 JSON 的场景。
   */
  static fromRawError(rawBody: string, upstreamStatus?: number): MiniprogramException {
    const parsed = safeParseJson(rawBody);
    if (parsed && parsed.errcode !== undefined && parsed.errcode !== 0) {
      return MiniprogramException.fromApiError(parsed.errcode, parsed.errmsg, upstreamStatus);
    }
    return new MiniprogramException(
      'MINIPROGRAM_BINARY_ERROR',
      `微信小程序接口返回了无法解析的应答（HTTP ${upstreamStatus ?? 200}）`,
    );
  }
}

/** 判定任意异常是否为微信小程序领域异常 */
export function isMiniprogramError(error: unknown): error is MiniprogramException {
  return error instanceof MiniprogramException;
}

/**
 * 判定异常是否可安全原样重试
 *
 * 仅「微信侧瞬态故障」与「频率限制」可重试；参数、签名、权限、风控、业务状态类
 * 一律不可重试（重试只会重复失败，风控与订阅类还可能放大用户侧影响）。
 *
 * 判定完全由错误码映射表驱动 —— **未收录的错误码一律不重试**：
 * 未知错误更可能是参数或权限问题，盲目重试只会放大调用量。
 */
export function isMiniprogramRetryable(error: unknown): boolean {
  return isMiniprogramError(error) && error.plainRetryable;
}

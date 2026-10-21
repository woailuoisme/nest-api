import { HttpException, HttpStatus } from '@nestjs/common';

import { safeParseJson } from '../json.util';
import {
  WEPAY_DEFAULT_ERROR_STATUS,
  WEPAY_ERROR_MAP,
  type WepayErrorCategory,
  type WepayErrorDescriptor,
} from './wepay.constants';

/** 微信支付错误应答体中的定位信息（官方在参数类错误中返回） */
export interface WepayErrorDetail {
  /** 出错的字段名 */
  field?: string;
  /** 出错的字段值 */
  value?: string;
  /** 具体问题描述 */
  issue?: string;
  /** 出错位置，如 body / path / query */
  location?: string;
}

/** 微信支付错误应答体 */
interface WepayApiErrorBody {
  code?: string;
  message?: string;
  detail?: WepayErrorDetail;
}

/** 安全解析 JSON 文本，失败返回 null（用于容错解析微信错误应答） */

/** 查询错误码的处置描述 */
export function getWepayErrorDescriptor(code: string | undefined): WepayErrorDescriptor | undefined {
  return code ? WEPAY_ERROR_MAP[code] : undefined;
}

/** 查询错误码的分类（未收录返回 undefined） */
export function getWepayErrorCategory(code: string | undefined): WepayErrorCategory | undefined {
  return getWepayErrorDescriptor(code)?.category;
}

/**
 * 解析错误应返回的 HTTP 状态码
 *
 * 官方对同一错误码在不同接口标注不同状态（如 `MCH_NOT_EXISTS` 在下单为 400、在退款为 404），
 * 因此**凡携带微信应答者一律采用应答中的原始状态码** —— 它就是官方映射本身，可保证 100% 一致。
 *
 * 仅当没有可用的应答状态（本模块自定义错误码、网络/超时/验签等本地失败）时，
 * 才回退到 {@link WEPAY_ERROR_MAP} 中的状态；仍未收录则兜底 502 Bad Gateway。
 */
export function resolveWepayErrorStatus(code: string | undefined, upstreamStatus?: number): HttpStatus {
  if (upstreamStatus !== undefined && upstreamStatus >= 400 && upstreamStatus <= 599) {
    return upstreamStatus as HttpStatus;
  }

  return getWepayErrorDescriptor(code)?.status ?? WEPAY_DEFAULT_ERROR_STATUS;
}

/**
 * 微信支付领域异常
 *
 * 将微信侧错误码统一转译为语义化 HTTP 状态，交由全局 HttpExceptionFilter 输出
 * `{ error: { code, message } }` 信封；调用方可据 `wepayCode` / `getWepayErrorCategory`
 * 区分可重试与不可重试语义，无需硬编码错误码字符串。
 */
export class WepayException extends HttpException {
  constructor(
    /** 微信支付原始错误码（如 ORDER_CLOSED），或本模块自定义的 WEPAY_* 码 */
    readonly wepayCode: string,
    message: string,
    status: HttpStatus = resolveWepayErrorStatus(wepayCode),
    /** 微信侧 request-id，便于向其技术支持追查 */
    readonly requestId?: string,
    /** 官方返回的字段级定位信息 */
    readonly detail?: WepayErrorDetail,
  ) {
    super({ code: wepayCode, message }, status);
  }

  /** 错误分类（未收录的错误码返回 undefined） */
  get category(): WepayErrorCategory | undefined {
    return getWepayErrorCategory(this.wepayCode);
  }

  /**
   * 依据微信接口错误应答构造异常
   *
   * 应答体可解析且含 `code` 时采用其错误码与文案，并把 `detail` 结构化保留；
   * 否则降级为携带原始 HTTP 状态的通用错误（5xx 空体与网关 HTML 应答均走此分支）。
   */
  static fromApiError(status: number, rawBody: string, requestId?: string): WepayException {
    const parsed = safeParseJson<WepayApiErrorBody>(rawBody);
    if (parsed?.code) {
      const field = parsed.detail?.field ? `（字段 ${parsed.detail.field}）` : '';
      return new WepayException(
        parsed.code,
        `${parsed.message ?? '微信支付接口调用失败'}${field}`,
        resolveWepayErrorStatus(parsed.code, status),
        requestId,
        parsed.detail,
      );
    }

    return new WepayException(
      'WEPAY_HTTP_ERROR',
      `微信支付接口返回 HTTP ${status}`,
      resolveWepayErrorStatus('WEPAY_HTTP_ERROR', status),
      requestId,
    );
  }
}

/** 判定任意异常是否为微信支付领域异常 */
export function isWepayError(error: unknown): error is WepayException {
  return error instanceof WepayException;
}

/**
 * 判定异常是否可安全原样重试
 *
 * 仅「微信侧系统异常」与「频率限制」可重试；参数、签名、订单状态、账户与资源不存在等
 * 一律不可重试（重试只会重复失败，账户与状态类问题还可能放大资金风险）。
 * 非本模块异常按 5xx / 429 / 504 判定，覆盖网关超时等瞬态故障。
 */
export function isWepayRetryable(error: unknown): boolean {
  if (error instanceof WepayException) {
    const category = getWepayErrorCategory(error.wepayCode);
    if (category) {
      return category === 'upstream' || category === 'rate-limited';
    }
    return error.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR || error.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
  }

  return false;
}

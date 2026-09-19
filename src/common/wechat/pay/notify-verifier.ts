import type { KeyObject } from 'node:crypto';
import { decryptAesGcmResource } from './crypto/cipher';
import { assertFreshTimestamp, buildVerifyMessage, verifyMessage } from './crypto/verifier';
import type {
  WepayNotifyEnvelope,
  WepayNotifyHeaders,
  WepayNotifyPayload,
  WepayNotifyResource,
} from './interfaces/wepay.interface';
import { WepayException } from './wepay.exception';

/** 回调签名校验参数 */
export interface NotifySignatureParams {
  headers: WepayNotifyHeaders;
  /** 原始请求报文（必须以未重新序列化的原文参与验签） */
  rawBody: string;
  /** 时间戳容差（秒） */
  toleranceSeconds: number;
  /** 按 `Wechatpay-Serial` 解析验签公钥；无法匹配时应抛错 */
  resolvePublicKey: (serial: string | undefined) => KeyObject | Promise<KeyObject>;
}

/**
 * 校验微信支付回调签名与时间戳新鲜度（防重放）
 *
 * real 与 mock 驱动共用同一实现，避免安全校验逻辑在两处漂移：
 * 验签凭据由调用方按 serial 自行解析（real 走公钥/平台证书，mock 走进程内自签凭据）。
 */
export async function verifyNotifySignature(params: NotifySignatureParams): Promise<void> {
  const { timestamp, nonce, signature, serial } = params.headers;
  if (!timestamp || !nonce || !signature) {
    throw new WepayException('WEPAY_NOTIFY_HEADERS_MISSING', '微信支付回调缺少签名请求头');
  }

  try {
    assertFreshTimestamp(timestamp, params.toleranceSeconds);
  } catch (error) {
    throw new WepayException('WEPAY_NOTIFY_TIMESTAMP_INVALID', (error as Error).message);
  }

  const publicKey = await params.resolvePublicKey(serial);
  if (!verifyMessage(buildVerifyMessage(timestamp, nonce, params.rawBody), signature, publicKey)) {
    throw new WepayException('WEPAY_NOTIFY_SIGNATURE_INVALID', '微信支付回调验签失败');
  }
}

/**
 * 解密回调 resource 密文，返回业务资源原文
 *
 * 使用真实 AES-256-GCM，real 与 mock 驱动共用，确保本地联调与生产链路完全同构。
 */
export function decryptResourcePayload(resource: WepayNotifyResource, apiV3Key: string): Record<string, unknown> {
  try {
    return JSON.parse(decryptAesGcmResource(resource, apiV3Key)) as Record<string, unknown>;
  } catch (error) {
    // 签名已证明报文来自微信，解密失败通常意味着 APIv3 密钥配置错误，按服务端配置问题上报
    throw new WepayException('WEPAY_NOTIFY_DECRYPT_FAILED', `微信支付回调解密失败：${(error as Error).message}`);
  }
}

/**
 * 解析回调信封并解密 resource，组装为规范化载荷
 */
export function buildNotifyPayload(
  rawBody: string,
  decryptResource: (resource: WepayNotifyResource) => Record<string, unknown>,
): WepayNotifyPayload {
  let envelope: WepayNotifyEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WepayNotifyEnvelope;
  } catch {
    throw new WepayException('WEPAY_NOTIFY_MALFORMED', '微信支付回调报文不是合法 JSON');
  }

  if (!envelope?.resource?.ciphertext) {
    throw new WepayException('WEPAY_NOTIFY_MALFORMED', '微信支付回调缺少 resource 密文');
  }

  return {
    id: envelope.id,
    eventType: envelope.event_type,
    resourceType: envelope.resource_type,
    summary: envelope.summary,
    createTime: envelope.create_time,
    resource: decryptResource(envelope.resource),
  };
}

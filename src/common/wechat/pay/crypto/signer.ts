import { createPrivateKey, createSign, type KeyObject, randomBytes } from 'node:crypto';
import { WEPAY_SIGN_TYPE } from '../wepay.constants';

/** 微信支付 v3 请求待签名串所在的拼接顺序 */
export interface WepayRequestSignMessageParams {
  /** HTTP 方法，内部自动大写 */
  method: string;
  /** 请求 URL 的路径与查询串（不含协议与域名） */
  urlPath: string;
  /** 秒级时间戳字符串 */
  timestamp: string;
  /** 随机串 */
  nonceStr: string;
  /** 请求体原文，无请求体时为空串 */
  body: string;
}

/**
 * 归一化 PEM 文本：兼容 env 中以 `\n` 转义传递的多行私钥与首尾空白
 */
export function normalizePem(pem: string): string {
  return (pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem).trim();
}

/**
 * 构造微信支付 v3 请求待签名串：`HTTP_METHOD\nURL\ntimestamp\nnonce\nbody\n`
 */
export function buildRequestSignMessage(params: WepayRequestSignMessageParams): string {
  const segments = [params.method.toUpperCase(), params.urlPath, params.timestamp, params.nonceStr, params.body];
  return `${segments.join('\n')}\n`;
}

/** 生成随机串作为 nonce_str */
export function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

/** 从 PEM 文本加载 RSA 商户私钥 */
export function loadPrivateKey(pem: string): KeyObject {
  return createPrivateKey({ key: normalizePem(pem), format: 'pem' });
}

/** 使用商户私钥对消息做 SHA256withRSA 签名，输出 base64 */
export function signMessage(message: string, privateKey: KeyObject): string {
  return createSign('RSA-SHA256').update(message, 'utf8').sign(privateKey, 'base64');
}

/**
 * 构造微信支付 v3 Authorization 请求头
 *
 * 形如 `WECHATPAY2-SHA256-RSA2048 mchid="...",nonce_str="...",signature="...",timestamp="...",serial_no="..."`
 */
export function buildAuthorizationHeader(params: {
  mchid: string;
  serialNo: string;
  nonceStr: string;
  timestamp: string;
  signature: string;
}): string {
  return [
    WEPAY_SIGN_TYPE,
    `mchid="${params.mchid}"`,
    `nonce_str="${params.nonceStr}"`,
    `signature="${params.signature}"`,
    `timestamp="${params.timestamp}"`,
    `serial_no="${params.serialNo}"`,
  ].join(' ');
}

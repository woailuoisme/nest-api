import type { KeyObject } from 'node:crypto';

import { randomNonce, signMessage } from './crypto/signer';
import type { AppPayParams, JsapiPayParams } from './interfaces/wepay.interface';

/** 二次签名所需的商户侧上下文 */
export interface SecondSignContext {
  /** 直连商户 appid */
  appid: string;
  /** 直连商户号（仅 App 支付参数需要） */
  mchid: string;
  /** 商户 API 私钥 */
  privateKey: KeyObject;
}

/**
 * 构造 JSAPI 二次签名参数
 *
 * 官方待签串为 `appId\ntimeStamp\nnonceStr\npackage\n`，其中 `package` 固定为 `prepay_id=<prepayId>`。
 *
 * real 与 mock 驱动共用本实现：待签串格式属**安全语义**，两份实现一旦漂移，
 * 就会出现「本地联调通过、线上拉起支付失败」这类极难定位的问题。
 */
export function buildJsapiPayParams(context: SecondSignContext, prepayId: string): JsapiPayParams {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomNonce();
  const pkg = `prepay_id=${prepayId}`;

  return {
    appId: context.appid,
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign: signMessage(`${context.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`, context.privateKey),
  };
}

/**
 * 构造 App 二次签名参数
 *
 * 官方待签串为 `appId\ntimeStamp\nnonceStr\nprepayId\n` —— 与 JSAPI 的差异在于**直接携带 prepayId
 * 而非 `package=prepay_id=...`**，这是两类支付拉起方式不可互换的根因。
 */
export function buildAppPayParams(context: SecondSignContext, prepayId: string): AppPayParams {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomNonce();

  return {
    appId: context.appid,
    partnerId: context.mchid,
    prepayId,
    package: 'Sign=WXPay',
    nonceStr,
    timeStamp,
    sign: signMessage(`${context.appid}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`, context.privateKey),
  };
}

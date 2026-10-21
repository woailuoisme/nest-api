import { createHmac } from 'node:crypto';

/** 原生安全 Base64URL 编码（零外部依赖） */
export function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * 原生 HS256 JWT 签名生成器
 *
 * 供 Centrifugo 连接令牌与 IoT 设备令牌共用：签名逻辑只保留一份，
 * 避免两处各自演进（换算法、改 header、补 `typ` 校验时漏改另一边）。
 */
export function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const hmac = createHmac('sha256', secret);
  hmac.update(signatureInput);
  const signatureB64 = toBase64Url(hmac.digest());

  return `${signatureInput}.${signatureB64}`;
}

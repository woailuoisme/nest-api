import { createHash, timingSafeEqual } from 'node:crypto';

/** 恒定时间字符串比较：先 SHA-256 归一化长度，杜绝长度/内容时序侧信道 */
export function safeEqual(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest();
  const bHash = createHash('sha256').update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

/**
 * Basic Auth 请求头校验（供运维面板等轻量 Basic Auth 场景复用）
 * 使用首个冒号分割用户名与密码，兼容密码中包含冒号的情形。
 * @param header - 请求的 Authorization 头
 * @param user - 预期用户名
 * @param pass - 预期密码
 */
export function matchesBasicAuth(header: string | undefined, user: string, pass: string): boolean {
  if (!header) return false;
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) return false;
  const givenUser = decoded.slice(0, colonIdx);
  const givenPass = decoded.slice(colonIdx + 1);
  return safeEqual(givenUser, user) && safeEqual(givenPass, pass);
}

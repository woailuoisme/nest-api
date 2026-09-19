import { createHmac } from 'node:crypto';

/**
 * 计算用户登录态签名
 *
 * 官方算法：`signature = hmac_sha256(session_key, data)`，以 **session_key 作为密钥**，
 * 取小写十六进制结果。校验/重置登录态时被签名的内容为**空字符串**
 * （`signature = hmac_sha256(session_key, "")`），小游戏虚拟支付等场景则签原始报文。
 *
 * 该签名使得服务端无需明文传输 session_key 即可证明自己持有它。
 *
 * @param sessionKey 用户会话密钥（严禁下发到前端或写入日志）
 * @param data 被签名的内容，登录态校验与重置场景固定为空字符串
 */
export function buildSessionSignature(sessionKey: string, data = ''): string {
  return createHmac('sha256', sessionKey).update(data, 'utf8').digest('hex');
}

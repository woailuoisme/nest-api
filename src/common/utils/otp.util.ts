/**
 * OTP 验证码工具 — 加密安全随机验证码生成
 *
 * 使用 `node:crypto.randomInt()` 生成 6 位加密安全验证码，适合短信、邮件通知等业务场景。
 * 注：基于 RFC 6238 的时间动态口令 (TOTP 2FA) 已由 Better Auth 内置安全接管。
 *
 * ## 使用示例
 *
 * ```ts
 * import { Otp } from '@/common/utils/otp.util';
 *
 * const code = Otp.generate();
 * // → "482916" (加密安全 6 位随机字符串)
 * ```
 */
import { randomInt } from 'node:crypto';
import { OTP } from '@/common/constants/app.constants';

/**
 * OTP 门面 — 提供高强度随机验证码生成
 */
export const Otp = {
  /**
   * 生成 6 位随机数字验证码
   * 使用 crypto.randomInt() 保证加密安全
   */
  generate(): string {
    const min = 10 ** (OTP.LENGTH - 1);
    const max = 10 ** OTP.LENGTH;
    return randomInt(min, max).toString();
  },
};

/**
 * OTP 验证码工具 — 随机码 + TOTP 双模式
 *
 * - **随机模式**: `crypto.randomInt()` 生成 6 位加密安全验证码，适合短信/邮件
 * - **TOTP 模式**: 基于 `otplib` (RFC 6238)，时间窗口 30s，适合 Authenticator App
 *
 * ## 使用示例
 *
 * ### 随机验证码
 *
 * ```ts
 * import { Otp } from '@/common/utils/otp.util';
 *
 * Otp.generate();
 * // → "482916"  (每次调用结果不同)
 * ```
 *
 * ### TOTP 基于时间的验证码
 *
 * ```ts
 * const secret = Otp.generateTotpSecret();
 * // → "JBSWY3DPEHPK3PXP"  (Base32，可存入数据库)
 *
 * const token = await Otp.generateTotp(secret);
 * // → "123456"  (30 秒内有效)
 *
 * const ok = await Otp.verifyTotp(token, secret);
 * // → true      (容差 ±30s)
 *
 * const bad = await Otp.verifyTotp('000000', secret);
 * // → false
 * ```
 */
import { randomInt } from 'node:crypto';
import { generate, generateSecret, verify } from 'otplib';
import { OTP } from '@/common/constants/app.constants';

/**
 * OTP 门面 — 提供随机验证码和 TOTP 两种模式
 *
 * @example
 * ```ts
 * // 随机验证码
 * const code = Otp.generate(); // "482916"
 *
 * // TOTP 模式
 * const secret = Otp.generateTotpSecret(); // "JBSWY3DPEHPK3PXP"
 * const totp = await Otp.generateTotp(secret);   // "123456"
 * const ok = await Otp.verifyTotp(totp, secret); // true
 * ```
 */
export const Otp = {
  /**
   * 生成 6 位随机数字验证码
   * 使用 crypto.randomInt() 保证加密安全
   */
  generate(): string {
    return randomInt(100_000, 1_000_000).toString();
  },

  /**
   * 生成 TOTP 密钥 (Base32 编码)
   * 可存储到数据库用于后续验证
   */
  generateTotpSecret(): string {
    return generateSecret();
  },

  /**
   * 基于密钥生成当前 TOTP 验证码
   * @param secret - Base32 编码的密钥
   * @returns 6 位数字验证码
   */
  async generateTotp(secret: string): Promise<string> {
    return generate({ secret, period: OTP.TOTP_WINDOW });
  },

  /**
   * 验证 TOTP 验证码是否有效
   * @param token - 用户输入的验证码
   * @param secret - 存储的 Base32 密钥
   * @returns 验证结果
   */
  async verifyTotp(token: string, secret: string): Promise<boolean> {
    const result = await verify({
      token,
      secret,
      period: OTP.TOTP_WINDOW,
      epochTolerance: OTP.TOTP_WINDOW * OTP.TOTP_TOLERANCE,
    });
    return result.valid;
  },
};

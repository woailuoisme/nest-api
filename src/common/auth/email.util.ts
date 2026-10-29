/**
 * 邮箱归一化唯一实现。
 *
 * `user.email` 落库、登录查询与 OTP 目标（`otp_codes.target`）必须使用同一规则：
 * 任一处单独实现都会导致「码发到 A、校验按 B 查」这类恒定 401 且难以定位的问题。
 */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFC').toLowerCase();
}

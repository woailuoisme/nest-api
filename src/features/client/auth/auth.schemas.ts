import { i18nIssueMessage } from '@nestjs/i18n';
import { z } from 'zod';

/** 邮箱字段：254 为 RFC 5321 的地址长度上限，注册 / 登录 / 找回共用同一规则 */
const emailField = z.email().max(254);

/** 注册：沿用现有密码策略（8–128） */
export const SignUpSchema = z.strictObject({
  email: emailField,
  password: z.string().min(8).max(128),
});
export type SignUpRequest = z.infer<typeof SignUpSchema>;

/** 登录 */
export const SignInSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1),
});
export type SignInRequest = z.infer<typeof SignInSchema>;

/** 移动端换取令牌：密码 + 可选的第二因子 */
export const TokenRequestSchema = SignInSchema.extend({
  code: z.string().min(1).optional(),
  recoveryCode: z.string().min(1).optional(),
});
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const RefreshTokenSchema = z.strictObject({
  refreshToken: z.string().min(1),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>;

export const EmailSchema = z.strictObject({
  email: emailField,
});
export type EmailRequest = z.infer<typeof EmailSchema>;

/** 邮件链接中的一次性 token */
export const TokenSchema = z.strictObject({
  token: z.string().min(1),
});
export type EmailTokenRequest = z.infer<typeof TokenSchema>;

/** 找回密码：链接中的 token + 新密码 */
export const ResetPasswordSchema = z.strictObject({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordSchema>;

export const MfaCodeSchema = z.strictObject({
  code: z.string().min(1),
});
export type MfaCodeRequest = z.infer<typeof MfaCodeSchema>;

/** 第二因子校验：TOTP 或恢复码二选一 */
export const MfaVerifySchema = z
  .strictObject({
    code: z.string().min(1).optional(),
    recoveryCode: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: i18nIssueMessage('validation.mfaCodeExclusive'),
  });
export type MfaVerifyRequest = z.infer<typeof MfaVerifySchema>;

/** 会话 id 是 cookie token 的 SHA-256（base64url，43 字符） */
export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, i18nIssueMessage('validation.sessionId'));

/** 邮箱验证码（6 位数字） */
export const OtpCodeSchema = z.strictObject({
  code: z
    .string()
    .regex(/^\d{6}$/, i18nIssueMessage('validation.otp'))
    .describe('6 位验证码'),
});
export type OtpCodeRequest = z.infer<typeof OtpCodeSchema>;

/** 手机号（大陆 11 位或 E.164） */
export const OtpPhoneSchema = z.strictObject({
  phoneNumber: z.string().trim().min(6).max(32).describe('手机号（大陆 11 位或 E.164）'),
});
export type OtpPhoneRequest = z.infer<typeof OtpPhoneSchema>;

export const OtpPhoneVerifySchema = OtpPhoneSchema.extend({ code: OtpCodeSchema.shape.code });
export type OtpPhoneVerifyRequest = z.infer<typeof OtpPhoneVerifySchema>;

export const ApiKeyCreateSchema = z.strictObject({
  name: z.string().trim().max(64).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type ApiKeyCreateRequest = z.infer<typeof ApiKeyCreateSchema>;

export const ApiKeyIdSchema = z.string().min(1);

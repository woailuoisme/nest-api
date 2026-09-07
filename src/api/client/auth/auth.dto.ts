import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── 请求 DTO ────────────────────────────────────────────

export const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100).describe('用户名称'),
  email: z.email().toLowerCase().trim().describe('电子邮箱'),
  password: z.string().min(8).max(72).describe('密码 (8-72位)'),
  locale: z
    .enum(['zh', 'en'] as const)
    .optional()
    .describe('邮件语言'),
});

export class RegisterRequest extends createZodDto(RegisterSchema) {}

export const LoginSchema = z.object({
  email: z.email().toLowerCase().trim().describe('电子邮箱'),
  password: z.string().min(8).max(72).describe('密码 (8-72位)'),
});

export class LoginRequest extends createZodDto(LoginSchema) {}

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).describe('刷新令牌'),
});

export class RefreshTokenRequest extends createZodDto(RefreshTokenSchema) {}

export const ForgotPasswordSchema = z.object({
  email: z.email().toLowerCase().trim().describe('电子邮箱'),
  locale: z
    .enum(['zh', 'en'] as const)
    .optional()
    .describe('邮件语言'),
});

export class ForgotPasswordRequest extends createZodDto(ForgotPasswordSchema) {}

export const ResetPasswordSchema = z.object({
  token: z.string().min(1).describe('重置令牌'),
  password: z.string().min(8).max(72).describe('新密码 (8-72位)'),
});

export class ResetPasswordRequest extends createZodDto(ResetPasswordSchema) {}

export const VerifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Verification token is required').describe('邮箱验证令牌'),
});

export class VerifyEmailRequest extends createZodDto(VerifyEmailSchema) {}

/** 认证/授权令牌对 */
export class TokenPairResponse {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  refreshToken: string;
}

import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { OTP_CODE_TTL_MS, OtpService } from '@/common/auth/otp.service';
import { UsersRepository } from '@/common/auth/users.repository';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';

import {
  OtpCodeSchema,
  type OtpCodeRequest,
  OtpPhoneSchema,
  OtpPhoneVerifySchema,
  type OtpPhoneRequest,
  type OtpPhoneVerifyRequest,
} from './auth.schemas';

/** 验证码已发送响应 */
const OtpSentSchema = z.object({ sent: z.literal(true), expiresInSeconds: z.number().int() });
/** 邮箱验证码校验成功响应 */
const EmailVerifiedSchema = z.object({ emailVerified: z.literal(true) });
/** 手机验证码校验成功响应 */
const PhoneVerifiedSchema = z.object({ phoneVerified: z.literal(true) });

/** 发送端点限流：按账号维度（默认存档为按 IP，二者同时生效） */
const OTP_SEND_THROTTLE = { default: { limit: 5, ttl: 60_000 } } as const;

/**
 * 邮箱 / 手机验证码端点（归属验证，不做免密登录）。
 *
 * - 邮箱验证码发送到当前账号邮箱，校验通过即置 `user.email_verified`；
 * - 手机验证码发送到待绑定号码，校验通过即写入 `user.phone_number` 并标记已验证。
 */
@ApiTags('认证')
@Can.Anyone()
@Controller('auth/otp')
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly usersRepository: UsersRepository,
  ) {}

  @Throttle(OTP_SEND_THROTTLE)
  @Post('email')
  @HttpCode(202)
  @ApiOperation({ summary: '发送邮箱验证码' })
  @ApiSuccessResponse(OtpSentSchema, { status: 202, description: '验证码已入队' })
  async sendEmailCode(@CurrentUser() user: CurrentUserPayload): Promise<{ sent: true; expiresInSeconds: number }> {
    await this.otpService.sendEmailCode({ userId: user.id, email: user.email, name: user.name });
    return { sent: true, expiresInSeconds: OTP_CODE_TTL_MS / 1000 };
  }

  @Post('email/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '校验邮箱验证码' })
  @ApiSuccessResponse(EmailVerifiedSchema, { description: '邮箱已验证' })
  async verifyEmailCode(
    @CurrentUser() user: CurrentUserPayload,
    @Body({ schema: OtpCodeSchema }) body: OtpCodeRequest,
  ): Promise<{ emailVerified: true }> {
    const valid = await this.otpService.verifyEmailCode({ email: user.email, code: body.code });
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.usersRepository.markEmailVerified(user.id, user.email);
    return { emailVerified: true };
  }

  @Throttle(OTP_SEND_THROTTLE)
  @Post('phone')
  @HttpCode(202)
  @ApiOperation({ summary: '发送手机验证码' })
  @ApiSuccessResponse(OtpSentSchema, { status: 202, description: '验证码已发送' })
  async sendPhoneCode(
    @CurrentUser() user: CurrentUserPayload,
    @Body({ schema: OtpPhoneSchema }) body: OtpPhoneRequest,
  ): Promise<{ sent: true; expiresInSeconds: number }> {
    await this.otpService.sendSmsCode({ userId: user.id, phoneNumber: body.phoneNumber });
    return { sent: true, expiresInSeconds: OTP_CODE_TTL_MS / 1000 };
  }

  @Post('phone/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '校验手机验证码并绑定号码' })
  @ApiSuccessResponse(PhoneVerifiedSchema, { description: '手机号已绑定并标记验证' })
  async verifyPhoneCode(
    @CurrentUser() user: CurrentUserPayload,
    @Body({ schema: OtpPhoneVerifySchema }) body: OtpPhoneVerifyRequest,
  ): Promise<{ phoneVerified: true }> {
    const valid = await this.otpService.verifySmsCode({ phoneNumber: body.phoneNumber, code: body.code });
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.usersRepository.setPhoneNumber(user.id, this.otpService.normalizePhone(body.phoneNumber));
    return { phoneVerified: true };
  }
}

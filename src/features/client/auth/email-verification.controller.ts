import { CurrentUser, EmailVerificationService } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { BadRequestException, Body, ConflictException, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';

import { TokenSchema, type EmailTokenRequest } from './auth.schemas';

@ApiTags('认证')
@Can.Anyone()
@Controller('auth/email')
export class EmailVerificationController {
  constructor(private readonly emailVerificationService: EmailVerificationService) {}

  @Public()
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: '验证邮箱' })
  async verify(@Body({ schema: TokenSchema }) body: EmailTokenRequest) {
    const verified = await this.emailVerificationService.verify(body.token);
    if (!verified) {
      throw new BadRequestException('Invalid or expired link');
    }
    return { email: verified.email, emailVerified: true };
  }

  @Post('verification')
  @HttpCode(202)
  @ApiOperation({ summary: '重发验证邮件' })
  async resend(@CurrentUser() user: CurrentUserPayload): Promise<void> {
    if (user.emailVerified) {
      throw new ConflictException('Email address already verified');
    }
    await this.emailVerificationService.send(user);
  }
}

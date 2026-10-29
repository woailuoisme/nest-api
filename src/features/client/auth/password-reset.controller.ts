import { PasswordResetService } from '@nestjs/authentication';
import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { EmailSchema, type EmailRequest, ResetPasswordSchema, type ResetPasswordRequest } from './auth.schemas';

@ApiTags('认证')
@Public()
@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  /** 无论地址是否存在，都以同样的 202 与耗时返回 */
  @Post('forgot')
  @HttpCode(202)
  @ApiOperation({ summary: '申请重置密码' })
  forgot(@Body({ schema: EmailSchema }) body: EmailRequest): void {
    this.passwordResetService.request(body.email);
  }

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({ summary: '重置密码' })
  async reset(@Body({ schema: ResetPasswordSchema }) body: ResetPasswordRequest) {
    const result = await this.passwordResetService.reset(body.token, body.password, { signIn: true });
    if (!result) {
      throw new BadRequestException('Invalid or expired link');
    }
    return { mfaRequired: result.signedIn?.session.mfa === 'pending' };
  }
}

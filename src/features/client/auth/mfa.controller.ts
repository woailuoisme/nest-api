import {
  Authenticate,
  CurrentSession,
  CurrentUser,
  MfaService,
  SessionService,
  SignInService,
  TokenService,
  type SessionRecord,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { Public as AppPublic } from '@/common/decorators/public.decorator';

import { MfaCodeSchema, type MfaCodeRequest, MfaVerifySchema, type MfaVerifyRequest } from './auth.schemas';

@ApiTags('认证')
@Can.Anyone()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly signInService: SignInService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('enroll')
  @HttpCode(200)
  @ApiOperation({ summary: '开启两步验证' })
  enroll(@CurrentUser() user: CurrentUserPayload) {
    return this.mfaService.enroll(user.id, user.email);
  }

  @Authenticate({ mfa: true })
  @Post('replace')
  @HttpCode(200)
  @ApiOperation({ summary: '更换验证器' })
  replace(@CurrentUser() user: CurrentUserPayload) {
    return this.mfaService.enroll(user.id, user.email, { replace: true });
  }

  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({ summary: '确认验证器' })
  async confirm(@CurrentUser('id') userId: string, @Body({ schema: MfaCodeSchema }) body: MfaCodeRequest) {
    if (!(await this.signInService.confirmMfa(userId, body.code))) {
      throw new UnauthorizedException('Invalid code');
    }
    return { recoveryCodes: await this.mfaService.generateRecoveryCodes(userId) };
  }

  @AppPublic()
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: '完成两步验证' })
  async verify(@Body({ schema: MfaVerifySchema }) body: MfaVerifyRequest) {
    const issued = await this.signInService.completeMfa({ code: body.code, recoveryCode: body.recoveryCode });
    if (!issued) {
      throw new UnauthorizedException('Invalid code');
    }
    return { mfa: issued.session.mfa };
  }

  @Authenticate({ mfa: true })
  @Post('disable')
  @HttpCode(204)
  @ApiOperation({ summary: '关闭两步验证' })
  async disable(
    @CurrentUser('id') userId: string,
    @CurrentSession() current: SessionRecord,
    @Body({ schema: MfaCodeSchema }) body: MfaCodeRequest,
  ): Promise<void> {
    if (!(await this.mfaService.verifyTotp(userId, body.code))) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.mfaService.disable(userId);
    await this.sessionService.revokeAll(userId, { except: current.id });
    await this.tokenService.revokeAll(userId);
  }
}

import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthSessionService } from '@/common/auth/auth-session.service';
import { Public } from '@/common/decorators/public.decorator';

import { SignInSchema, type SignInRequest, SignUpSchema, type SignUpRequest } from './auth.schemas';

@ApiTags('认证')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authSession: AuthSessionService) {}

  @Post('sign-up')
  @ApiOperation({ summary: '注册' })
  signUp(@Body({ schema: SignUpSchema }) body: SignUpRequest) {
    return this.authSession.signUpWithPassword(body.email, body.password);
  }

  @Post('sign-in')
  @HttpCode(200)
  @ApiOperation({ summary: '登录' })
  async signIn(@Body({ schema: SignInSchema }) body: SignInRequest) {
    const { session } = await this.authSession.signInWithPassword(body.email, body.password);
    return { mfaRequired: session.mfa === 'pending' };
  }
}

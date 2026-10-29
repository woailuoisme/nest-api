import { TokenService } from '@nestjs/authentication';
import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CredentialsService } from '@/common/auth/credentials.service';
import { Public } from '@/common/decorators/public.decorator';

import { RefreshTokenSchema, type RefreshTokenRequest, TokenRequestSchema, type TokenRequest } from './auth.schemas';

@ApiTags('认证')
@Public()
@Controller('auth/token')
export class TokensController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly tokenService: TokenService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: '签发访问令牌' })
  async issue(@Body({ schema: TokenRequestSchema }) body: TokenRequest) {
    const user = await this.credentialsService.verify(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.tokenService.issue(user.id, {
      method: 'password',
      claims: { amr: ['pwd'] },
      secondFactor: { code: body.code, recoveryCode: body.recoveryCode },
    });
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '刷新访问令牌' })
  refresh(@Body({ schema: RefreshTokenSchema }) body: RefreshTokenRequest) {
    return this.tokenService.refresh(body.refreshToken);
  }

  @Post('revoke')
  @HttpCode(204)
  @ApiOperation({ summary: '吊销刷新令牌' })
  async revoke(@Body({ schema: RefreshTokenSchema }) body: RefreshTokenRequest) {
    await this.tokenService.revoke(body.refreshToken);
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { I18N } from '@/common/constants/app.constants';
import { Public } from '@/common/decorators/public.decorator';
import { ApiNoContentResponse, ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import {
  ForgotPasswordRequest,
  LoginRequest,
  RefreshTokenRequest,
  RegisterRequest,
  ResetPasswordRequest,
  TokenPairResponse,
  VerifyEmailRequest,
} from './auth.dto';
import { GoogleAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { OAuthProfile } from './strategies/oauth-profile.interface';

@ApiTags('认证')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '注册' })
  @ApiSuccessResponse(TokenPairResponse, { status: 201, description: '注册成功' })
  register(@Body() dto: RegisterRequest): Promise<TokenPairResponse> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录' })
  @ApiSuccessResponse(TokenPairResponse, { description: '登录成功' })
  login(@Body() dto: LoginRequest): Promise<TokenPairResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiSuccessResponse(TokenPairResponse, { description: '刷新成功' })
  refresh(@Body() dto: RefreshTokenRequest): Promise<TokenPairResponse> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '退出登录' })
  @ApiNoContentResponse({ description: '注销成功' })
  logout(@Body() dto: RefreshTokenRequest): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '忘记密码' })
  @ApiNoContentResponse({ description: '重置邮件已发送' })
  forgotPassword(@Body() dto: ForgotPasswordRequest): Promise<void> {
    return this.authService.forgotPassword(dto.email, dto.locale ?? I18N.FALLBACK_LANG);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '重置密码' })
  @ApiNoContentResponse({ description: '密码重置成功' })
  resetPassword(@Body() dto: ResetPasswordRequest): Promise<void> {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Get('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '验证邮箱' })
  @ApiNoContentResponse({ description: '邮箱验证成功' })
  verifyEmail(@Query() query: VerifyEmailRequest): Promise<void> {
    return this.authService.verifyEmail(query.token);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google 登录' })
  @ApiResponse({ status: 302, description: '重定向至 Google 授权页面' })
  googleLogin(): void {
    // GoogleAuthGuard 会自动重定向至 Google 授权页面，此处无需额外处理
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  googleCallback(@Req() req: FastifyRequest & { user?: OAuthProfile }): Promise<TokenPairResponse> {
    return this.authService.validateOAuthLogin(req.user as OAuthProfile);
  }
}

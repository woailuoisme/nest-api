import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ApiNoContentResponse, ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import {
  AdminLoginRequest,
  AdminProfileResponse,
  AdminRefreshTokenRequest,
  AdminTokenPairResponse,
} from './admin-auth.dto';
import { AdminAuthService } from './admin-auth.service';

@ApiTags('认证管理')
@ApiBearerAuth()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录' })
  @ApiSuccessResponse(AdminTokenPairResponse, { description: '登录成功' })
  login(@Body() dto: AdminLoginRequest, @Req() req: FastifyRequest): Promise<AdminTokenPairResponse> {
    return this.adminAuthService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiSuccessResponse(AdminTokenPairResponse, { description: '刷新成功' })
  refresh(@Body() dto: AdminRefreshTokenRequest): Promise<AdminTokenPairResponse> {
    return this.adminAuthService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '退出登录' })
  @ApiNoContentResponse({ description: '注销成功' })
  logout(@Body() dto: AdminRefreshTokenRequest): Promise<void> {
    return this.adminAuthService.logout(dto.refreshToken);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '个人信息' })
  @ApiSuccessResponse(AdminProfileResponse, { description: '获取成功' })
  getProfile(@CurrentUser('id') adminId: number): Promise<AdminProfileResponse> {
    return this.adminAuthService.getProfile(adminId);
  }
}

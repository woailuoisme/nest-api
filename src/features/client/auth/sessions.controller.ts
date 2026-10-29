import { CurrentSession, CurrentUser, SessionService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { SessionIdSchema } from './auth.schemas';

@ApiTags('认证')
@Can.Anyone()
@Controller('auth')
export class SessionsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly signInService: SignInService,
  ) {}

  @Get('sessions')
  @ApiOperation({ summary: '查看登录设备' })
  async list(@CurrentUser('id') userId: string, @CurrentSession() current: SessionRecord) {
    const sessions = await this.sessionService.list(userId);
    return sessions.map(({ id, createdAt, lastActiveAt, metadata }) => ({
      id,
      createdAt,
      lastActiveAt,
      userAgent: metadata?.userAgent ?? null,
      ipAddress: metadata?.ipAddress ?? null,
      current: id === current.id,
    }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '下线指定设备' })
  async revoke(@CurrentUser('id') userId: string, @Param('id', { schema: SessionIdSchema }) id: string): Promise<void> {
    if (!(await this.sessionService.revoke(id, { userId }))) {
      throw new NotFoundException();
    }
  }

  @Public()
  @Post('sign-out')
  @HttpCode(204)
  @ApiOperation({ summary: '退出登录' })
  async signOut(): Promise<void> {
    if (!(await this.signInService.signOut())) {
      throw new UnauthorizedException();
    }
  }

  @Post('sign-out-everywhere')
  @HttpCode(204)
  @ApiOperation({ summary: '退出所有设备' })
  async signOutEverywhere(@CurrentUser('id') userId: string): Promise<void> {
    await this.signInService.signOutEverywhere(userId);
  }
}

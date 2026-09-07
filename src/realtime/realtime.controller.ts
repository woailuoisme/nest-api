import { Body, Controller, type MessageEvent, Post, Req, Sse, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { JwtAuthGuard } from '@/api/client/auth/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { BypassTransform } from '@/common/decorators/response.decorator';
import { SseAuthGuard } from './guards/sse-auth.guard';
import { PusherAuthDto } from './realtime.dto';
import { RealtimeService } from './realtime.service';

/**
 * 统一实时通信 HTTP 控制器
 * 暴露标准 Server-Sent Events (SSE) 订阅端点与 Pusher / Soketi 频道鉴权端点。
 */
@ApiExcludeController()
@ApiTags('实时通信')
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * 建立当前登录用户的专属 SSE 实时事件流
   */
  @ApiOperation({ summary: '实时事件流' })
  @ApiBearerAuth()
  @ApiQuery({ name: 'token', required: false, description: 'JWT 访问凭据 (支持 EventSource ?token= 传参)' })
  @ApiResponse({ status: 200, description: 'SSE 事件流建立成功 (text/event-stream)' })
  @ApiResponse({ status: 401, description: '未认证或 Token 过期' })
  @SkipThrottle() // SSE 长连接重连豁免：防止限流误伤断线重连风暴，鉴权由 SseAuthGuard 强制兜底
  @Public()
  @BypassTransform()
  @UseGuards(SseAuthGuard)
  @Sse('stream')
  stream(@CurrentUser() user: CurrentUserPayload, @Req() req: FastifyRequest): Observable<MessageEvent> {
    return this.realtimeService.createSseStream(user, req);
  }

  /**
   * Pusher / Soketi 私有及在场频道订阅签名鉴权
   */
  @ApiOperation({ summary: '频道订阅鉴权' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: '返回合法的 Pusher Auth 签名凭证' })
  @ApiResponse({ status: 403, description: '当前用户无权订阅目标频道' })
  @UseGuards(JwtAuthGuard)
  @Post('auth')
  authenticate(@CurrentUser() user: CurrentUserPayload, @Body() dto: PusherAuthDto) {
    return this.realtimeService.authenticatePusher(user, dto);
  }
}

/**
 * 兼容 Laravel Echo / pusher-js 默认行为的鉴权路由 (/broadcasting/auth)
 */
@ApiTags('实时通信 (兼容)')
@Controller({ path: 'broadcasting', version: VERSION_NEUTRAL })
export class BroadcastingController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @ApiOperation({ summary: '广播频道鉴权' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('auth')
  authenticate(@CurrentUser() user: CurrentUserPayload, @Body() dto: PusherAuthDto) {
    return this.realtimeService.authenticatePusher(user, dto);
  }
}

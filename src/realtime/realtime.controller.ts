import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { RealtimeChannelsService } from './channels/realtime-channels.service';
import {
  RealtimeChannelInfoDto,
  RealtimeSubscribeDto,
  RealtimeSubscribeResponseDto,
  RealtimeTokenQueryDto,
  RealtimeTokenResponseDto,
} from './dto/realtime.dto';
import { RealtimeEventsService } from './realtime-events.service';

/**
 * 统一实时通信接口控制器
 * 提供长连接鉴权 Token 签发、动态频道订阅授权与频道清单查询。
 * 同时挂载 /realtime, /websocket, /sse 三重路由前缀，实现 100% 协议与路径平滑过渡。
 */
@ApiTags('实时通信')
@ApiBearerAuth()
@Controller(['realtime', 'websocket', 'sse'])
export class RealtimeController {
  constructor(
    private readonly eventsService: RealtimeEventsService,
    private readonly channelsService: RealtimeChannelsService,
  ) {}

  @Get('token')
  @ApiOperation({ summary: '获取实时长连接 Token' })
  @ApiSuccessResponse(RealtimeTokenResponseDto, { description: '成功签发实时长连接凭据' })
  createConnectionToken(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: RealtimeTokenQueryDto,
    @Req() req?: FastifyRequest,
  ): RealtimeTokenResponseDto {
    const protocol = this.resolveProtocol(query.protocol, req?.url);
    return this.eventsService.createConnectionToken(user, protocol);
  }

  /**
   * 依据显式查询参数或请求挂载路径智能推导长连接传输协议
   */
  private resolveProtocol(queryProtocol?: 'websocket' | 'sse', reqUrl?: string): 'websocket' | 'sse' {
    if (queryProtocol) {
      return queryProtocol;
    }
    const isSsePath = Boolean(reqUrl?.includes('/sse'));
    return isSsePath ? 'sse' : 'websocket';
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '实时频道订阅鉴权' })
  @ApiSuccessResponse(RealtimeSubscribeResponseDto, { description: '订阅鉴权成功，签发订阅 Token' })
  async subscribe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RealtimeSubscribeDto,
  ): Promise<RealtimeSubscribeResponseDto> {
    return this.eventsService.subscribeChannel(user, dto.channel, dto.client);
  }

  @Get('channels')
  @ApiOperation({ summary: '查询实时支持的频道清单' })
  @ApiSuccessResponse(RealtimeChannelInfoDto, { isArray: true, description: '频道规则列表' })
  listChannels(): RealtimeChannelInfoDto[] {
    return this.channelsService.listRegisteredChannels();
  }
}

// 兼容别名导出
export const WebsocketController = RealtimeController;
export type WebsocketController = RealtimeController;
export const SseController = RealtimeController;
export type SseController = RealtimeController;

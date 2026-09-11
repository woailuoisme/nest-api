import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import {
  WebsocketChannelInfoDto,
  WebsocketSubscribeDto,
  WebsocketSubscribeResponseDto,
  WebsocketTokenResponseDto,
} from './dto/websocket.dto';
import { WebsocketService } from './websocket.service';
import { WebsocketChannelsService } from './websocket-channels.service';

/**
 * WebSocket 长连接服务接口
 * 提供长连接鉴权 Token 签发、动态频道订阅授权与频道清单查询。
 */
@ApiTags('WebSocket通信')
@ApiBearerAuth()
@Controller('websocket')
export class WebsocketController {
  constructor(
    private readonly websocketService: WebsocketService,
    private readonly channelsService: WebsocketChannelsService,
  ) {}

  @Get('token')
  @ApiOperation({ summary: '获取 WebSocket 连接 Token' })
  @ApiSuccessResponse(WebsocketTokenResponseDto, { description: '成功签发 WebSocket 连接凭据' })
  createConnectionToken(@CurrentUser() user: CurrentUserPayload): WebsocketTokenResponseDto {
    return this.websocketService.createConnectionToken(user);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WebSocket 频道订阅鉴权' })
  @ApiSuccessResponse(WebsocketSubscribeResponseDto, { description: '订阅鉴权成功，签发订阅 Token' })
  async subscribe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: WebsocketSubscribeDto,
  ): Promise<WebsocketSubscribeResponseDto> {
    return this.websocketService.subscribeChannel(user, dto.channel, dto.client);
  }

  @Get('channels')
  @ApiOperation({ summary: '查询 WebSocket 支持的频道清单' })
  @ApiSuccessResponse(WebsocketChannelInfoDto, { isArray: true, description: '频道规则列表' })
  listChannels(): WebsocketChannelInfoDto[] {
    return this.channelsService.listRegisteredChannels();
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { SseChannelInfoDto, SseSubscribeDto, SseSubscribeResponseDto, SseTokenResponseDto } from './dto/sse.dto';
import { SseService } from './sse.service';
import { SseChannelsService } from './sse-channels.service';

/**
 * SSE 服务端推流长连接接口
 * 提供 SSE 连接凭据签发、频道订阅授权与频道清单查询。
 */
@ApiTags('SSE事件推送')
@ApiBearerAuth()
@Controller('sse')
export class SseController {
  constructor(
    private readonly sseService: SseService,
    private readonly channelsService: SseChannelsService,
  ) {}

  @Get('token')
  @ApiOperation({ summary: '获取 SSE 连接 Token' })
  @ApiSuccessResponse(SseTokenResponseDto, { description: '成功签发 SSE 连接凭据' })
  createConnectionToken(@CurrentUser() user: CurrentUserPayload): SseTokenResponseDto {
    return this.sseService.createConnectionToken(user);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SSE 频道订阅鉴权' })
  @ApiSuccessResponse(SseSubscribeResponseDto, { description: '订阅鉴权成功，签发订阅 Token' })
  async subscribe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: SseSubscribeDto,
  ): Promise<SseSubscribeResponseDto> {
    return this.sseService.subscribeChannel(user, dto.channel, dto.client);
  }

  @Get('channels')
  @ApiOperation({ summary: '查询 SSE 支持的频道清单' })
  @ApiSuccessResponse(SseChannelInfoDto, { isArray: true, description: '频道规则列表' })
  listChannels(): SseChannelInfoDto[] {
    return this.channelsService.listRegisteredChannels();
  }
}

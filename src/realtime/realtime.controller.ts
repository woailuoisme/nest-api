import { createHash, timingSafeEqual } from 'node:crypto';

import { Can } from '@nestjs/authorization';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { isProductionEnv } from '@/common/constants/app.constants';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import type { EnvConfig } from '@/config/env.validation';

import { RealtimeChannelsService } from './channels/realtime-channels.service';
import {
  CentrifugoProxyResponseDto,
  type CentrifugoProxySubscribeDto,
  CentrifugoProxySubscribeSchema,
  RealtimeChannelInfoDto,
  type RealtimeSubscribeDto,
  RealtimeSubscribeResponseDto,
  RealtimeSubscribeSchema,
  type RealtimeTokenQueryDto,
  RealtimeTokenQuerySchema,
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
@Can.Anyone()
@Controller(['realtime', 'websocket', 'sse'])
export class RealtimeController {
  constructor(
    private readonly eventsService: RealtimeEventsService,
    private readonly channelsService: RealtimeChannelsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  @Get('token')
  @ApiOperation({ summary: '获取实时长连接 Token' })
  @ApiSuccessResponse(RealtimeTokenResponseDto, { description: '成功签发实时长连接凭据' })
  createConnectionToken(
    @CurrentUser() user: CurrentUserPayload,
    @Query({ schema: RealtimeTokenQuerySchema }) query: RealtimeTokenQueryDto,
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
    @Body({ schema: RealtimeSubscribeSchema }) dto: RealtimeSubscribeDto,
  ): Promise<RealtimeSubscribeResponseDto> {
    return this.eventsService.subscribeChannel(user, dto.channel, dto.client);
  }

  /**
   * Centrifugo Proxy 回调入口（网关直连，无用户凭证）。
   *
   * 准入依赖两重约束：
   * 1. 共享密钥头校验（`CENTRIFUGO_PROXY_SECRET`）—— 确认调用方是网关而非公网任意来源。
   *    两端需成对配置（网关侧用 `CENTRIFUGO_PROXY_STATIC_HTTP_HEADERS`）；未配置时本校验不生效，
   *    此时仅依赖第 2 重约束，生产环境应开启。
   * 2. 身份与角色一律由 `handleProxySubscribe` 回查数据库，绝不采信请求体。
   */
  @Public()
  @Post('proxy/subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Centrifugo Proxy Webhook 频道订阅鉴权' })
  @ApiSuccessResponse(CentrifugoProxyResponseDto, { description: 'Centrifugo 订阅反向代理鉴权响应' })
  async proxySubscribe(
    @Body({ schema: CentrifugoProxySubscribeSchema }) dto: CentrifugoProxySubscribeDto,
    @Headers('x-centrifugo-proxy-secret') secret?: string,
  ): Promise<CentrifugoProxyResponseDto> {
    this.assertTrustedProxy(secret);
    return this.eventsService.handleProxySubscribe(dto);
  }

  /**
   * 恒定时间校验网关共享密钥。
   *
   * 生产环境 fail-closed：未配置密钥时直接拒绝，避免公开路由退化为「任意 user + 频道」
   * 的授权探测接口（env 校验只在启用 REALTIME_URL 时强制该密钥，未启用 realtime 的
   * 生产部署仍需单独兜底）。本地开发未配置时跳过，便于直连调试。
   */
  private assertTrustedProxy(provided?: string): void {
    const expected = this.config.get('CENTRIFUGO_PROXY_SECRET', { infer: true });
    if (!expected) {
      if (isProductionEnv()) {
        throw new UnauthorizedException('Centrifugo proxy secret is not configured');
      }
      return;
    }

    // 先哈希再比较：长度差异不参与计时，消除密钥长度的旁路信息
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(provided ?? ''), digest(expected))) {
      throw new UnauthorizedException('Invalid Centrifugo proxy secret');
    }
  }

  @Get('channels')
  @ApiOperation({ summary: '查询实时支持的频道清单' })
  @ApiSuccessResponse(RealtimeChannelInfoDto, { isArray: true, description: '频道规则列表' })
  listChannels(): RealtimeChannelInfoDto[] {
    return this.channelsService.listRegisteredChannels();
  }
}

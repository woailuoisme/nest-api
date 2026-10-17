import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { ChannelExplorerService } from './channels/channel-explorer.service';
import { ChannelManager } from './channels/channel-manager.service';
import { PresenceService } from './channels/presence.service';
import { RealtimeChannelsService } from './channels/realtime-channels.service';
import { RealtimeEventsService } from './realtime-events.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { CentrifugoTransport } from './transports/centrifugo.transport';
import { REALTIME_PRIMARY_TRANSPORT } from './transports/realtime-transport.interface';

/**
 * 统一实时通信子系统模块 (RealtimeModule)
 * 全面基于 Centrifugo 高性能独立长连接网关驱动，
 * 聚合 Token 签发与订阅授权 Controller、模式匹配授权 ChannelManager、
 * 在场状态 PresenceService、领域事件总线 RealtimeEventsService 与发布门面 RealtimeService。
 *
 * 领域型模块，保持显式 import（不使用 @Global），以维持依赖关系可见性。
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [RealtimeController],
  providers: [
    ChannelManager,
    ChannelExplorerService,
    PresenceService,
    CentrifugoTransport,
    {
      provide: REALTIME_PRIMARY_TRANSPORT,
      useExisting: CentrifugoTransport,
    },
    RealtimeService,
    RealtimeChannelsService,
    RealtimeEventsService,
  ],
  exports: [
    RealtimeService,
    PresenceService,
    ChannelManager,
    ChannelExplorerService,
    CentrifugoTransport,
    REALTIME_PRIMARY_TRANSPORT,
    RealtimeEventsService,
    RealtimeChannelsService,
  ],
})
export class RealtimeModule {}

// 兼容别名导出
export const WebsocketModule = RealtimeModule;
export const SseModule = RealtimeModule;

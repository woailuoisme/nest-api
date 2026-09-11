import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RedisModule } from '@/database/redis.module';
import { ChannelExplorerService } from './channels/channel-explorer.service';
import { ChannelManager } from './channels/channel-manager.service';
import { PresenceService } from './channels/presence.service';
import { RealtimeService } from './realtime.service';
import { CentrifugoTransport } from './transports/centrifugo.transport';
import { REALTIME_PRIMARY_TRANSPORT } from './transports/realtime-transport.interface';

/**
 * 全局统一实时通信深模块 (RealtimeModule)
 * 全面基于 Centrifugo 高性能独立长连接网关驱动，
 * 对外暴露统一领域发布契约 (RealtimeService)，作为全局无状态底层中枢。
 */
@Global()
@Module({
  imports: [DiscoveryModule, RedisModule],
  controllers: [],
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
  ],
  exports: [
    RealtimeService,
    PresenceService,
    ChannelManager,
    ChannelExplorerService,
    CentrifugoTransport,
    REALTIME_PRIMARY_TRANSPORT,
  ],
})
export class RealtimeModule {}

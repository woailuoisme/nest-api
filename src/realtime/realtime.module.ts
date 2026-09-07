import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvConfig } from '@/config/env.validation';
import { RedisModule } from '@/database/redis.module';
import { ChannelManager } from './channels/channel-manager.service';
import { BroadcastingController, RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { LocalCompositeTransport } from './transports/local-composite.transport';
import { PusherTransport } from './transports/pusher.transport';
import { REALTIME_PRIMARY_TRANSPORT } from './transports/realtime-transport.interface';
import { RedisPubSubAdapter } from './transports/redis-pubsub.adapter';
import { SseTransport } from './transports/sse.transport';

/**
 * 全局统一实时通信深模块 (RealtimeModule)
 * 聚合 Server-Sent Events (SSE)、WebSocket (Socket.IO) 与外部 Pusher/Soketi 双驱动传输适配器，
 * 对外暴露统一领域发布契约 (RealtimeService)，并托管通用流式端点与频道鉴权。
 */
@Global()
@Module({
  imports: [JwtModule.register({}), RedisModule],
  controllers: [RealtimeController, BroadcastingController],
  providers: [
    ChannelManager,
    SseTransport,
    RealtimeGateway,
    RedisPubSubAdapter,
    PusherTransport,
    LocalCompositeTransport,
    {
      provide: REALTIME_PRIMARY_TRANSPORT,
      useFactory: (
        configService: ConfigService<EnvConfig, true>,
        localCompositeTransport: LocalCompositeTransport,
        pusherTransport: PusherTransport,
      ) => {
        const driver = configService.get('BROADCAST_DRIVER');
        return driver === 'pusher' ? pusherTransport : localCompositeTransport;
      },
      inject: [ConfigService, LocalCompositeTransport, PusherTransport],
    },
    RealtimeService,
  ],
  exports: [
    RealtimeService,
    RealtimeGateway,
    SseTransport,
    ChannelManager,
    PusherTransport,
    LocalCompositeTransport,
    REALTIME_PRIMARY_TRANSPORT,
  ],
})
export class RealtimeModule {}

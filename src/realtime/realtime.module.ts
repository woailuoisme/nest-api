import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { HttpClientModule, type HttpClientFactoryOptions } from '@nestjs/http-client';

import { DeadlineInterceptor } from '@/common/http/deadline.interceptor';
import type { EnvConfig } from '@/config/env.validation';

import { ChannelExplorerService } from './channels/channel-explorer.service';
import { ChannelManager } from './channels/channel-manager.service';
import { PresenceService } from './channels/presence.service';
import { RealtimeChannelsService } from './channels/realtime-channels.service';
import { RealtimeEventsService } from './realtime-events.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { CentrifugoTransport, parseCentrifugoDsn } from './transports/centrifugo.transport';
import { REALTIME_PRIMARY_TRANSPORT } from './transports/realtime-transport.interface';

/** 服务端调用 Centrifugo HTTP API 的客户端名 */
const CENTRIFUGO_HTTP_CLIENT = 'centrifugo';

/**
 * 从统一 DSN 推导出站客户端选项：baseUrl 与 API Key 都来自同一份 `REALTIME_URL`。
 *
 * 非法 DSN 在此静默跳过 —— `CentrifugoTransport` 自身会在构造期记录 warn 并降级为 no-op，
 * 此处重复告警只会把同一条配置错误打两遍。
 */
function createCentrifugoClientOptions(config: ConfigService<EnvConfig, true>): HttpClientFactoryOptions {
  const shared: HttpClientFactoryOptions = {
    // 出站静态上限：Worker / 定时任务等无请求上下文的调用点靠它兜底
    timeout: config.get('REALTIME_TIMEOUT_MS', { infer: true }),
    // 发布不是幂等操作：重复推送给用户是可见重复弹窗，漏推的正确答案在领域层（带 eventId 的幂等事件）
    retry: false,
  };

  const dsn = config.get('REALTIME_URL');
  if (!dsn) {
    return shared;
  }

  try {
    const { apiUrl, apiKey } = parseCentrifugoDsn(dsn);
    return { ...shared, baseUrl: apiUrl, headers: { authorization: `apikey ${apiKey}` } };
  } catch {
    return shared;
  }
}

/**
 * 统一实时通信子系统模块 (RealtimeModule)
 * 全面基于 Centrifugo 高性能独立长连接网关驱动，
 * 聚合 Token 签发与订阅授权 Controller、模式匹配授权 ChannelManager、
 * 在场状态 PresenceService、领域事件总线 RealtimeEventsService 与发布门面 RealtimeService。
 *
 * 领域型模块，保持显式 import（不使用 @Global），以维持依赖关系可见性。
 */
@Module({
  imports: [
    DiscoveryModule,
    // 就近注册而非全局：`baseUrl` 与 API Key 都是 per-upstream 的，等第二个上游落地再抽共享工厂
    HttpClientModule.registerAsync({
      name: CENTRIFUGO_HTTP_CLIENT,
      imports: [ConfigModule],
      inject: [ConfigService],
      // 拦截器类必须写在 useFactory 同级：模块构建早于工厂执行，Nest 需要提前拿到它们才能做 DI 解析
      interceptors: [DeadlineInterceptor],
      useFactory: createCentrifugoClientOptions,
    }),
  ],
  controllers: [RealtimeController],
  providers: [
    DeadlineInterceptor,
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

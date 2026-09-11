import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '@/database/redis.service';
import { ChannelExplorerService } from '@/realtime/channels/channel-explorer.service';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { PresenceService } from '@/realtime/channels/presence.service';
import { RealtimeChannelsService } from '@/realtime/channels/realtime-channels.service';
import { RealtimeController } from '@/realtime/realtime.controller';
import { RealtimeModule } from '@/realtime/realtime.module';
import { RealtimeService } from '@/realtime/realtime.service';
import { RealtimeEventsService } from '@/realtime/realtime-events.service';
import { CentrifugoTransport } from '@/realtime/transports/centrifugo.transport';
import { REALTIME_PRIMARY_TRANSPORT } from '@/realtime/transports/realtime-transport.interface';

describe('RealtimeModule', () => {
  let moduleRef: TestingModule;

  const mockConfigService = {
    get: (key: string) => {
      if (key === 'REALTIME_URL') {
        return 'centrifugo://test-key:test-secret@127.0.0.1:8000/api';
      }
      return undefined;
    },
  };

  const mockRedisService = {
    getClient: () => null,
  };

  @Global()
  @Module({
    providers: [
      { provide: ConfigService, useValue: mockConfigService },
      { provide: RedisService, useValue: mockRedisService },
    ],
    exports: [ConfigService, RedisService],
  })
  class MockGlobalModule {}

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [MockGlobalModule, RealtimeModule],
    }).compile();
  });

  it('模块应成功编译并解析所有核心服务', () => {
    expect(moduleRef).toBeDefined();

    const realtimeService = moduleRef.get(RealtimeService);
    const presenceService = moduleRef.get(PresenceService);
    const channelManager = moduleRef.get(ChannelManager);
    const channelExplorerService = moduleRef.get(ChannelExplorerService);
    const centrifugoTransport = moduleRef.get(CentrifugoTransport);
    const primaryTransport = moduleRef.get(REALTIME_PRIMARY_TRANSPORT);
    const realtimeEventsService = moduleRef.get(RealtimeEventsService);
    const realtimeChannelsService = moduleRef.get(RealtimeChannelsService);
    const realtimeController = moduleRef.get(RealtimeController);

    expect(realtimeService).toBeInstanceOf(RealtimeService);
    expect(presenceService).toBeInstanceOf(PresenceService);
    expect(channelManager).toBeInstanceOf(ChannelManager);
    expect(channelExplorerService).toBeInstanceOf(ChannelExplorerService);
    expect(centrifugoTransport).toBeInstanceOf(CentrifugoTransport);
    expect(realtimeEventsService).toBeInstanceOf(RealtimeEventsService);
    expect(realtimeChannelsService).toBeInstanceOf(RealtimeChannelsService);
    expect(realtimeController).toBeInstanceOf(RealtimeController);

    // 验证 REALTIME_PRIMARY_TRANSPORT 是否正确定位为 CentrifugoTransport 单例
    expect(primaryTransport).toBe(centrifugoTransport);
  });

  it('导出的服务在外部上下文中保持单例与协作关系', () => {
    const realtimeService = moduleRef.get(RealtimeService);
    const centrifugoTransport = moduleRef.get(CentrifugoTransport);

    expect(realtimeService.getCentrifugoTransport()).toBe(centrifugoTransport);
    expect(realtimeService.getDriver()).toBe('centrifugo');
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { RealtimeService } from '@/realtime/realtime.service';
import type { CentrifugoTransport } from '@/realtime/transports/centrifugo.transport';
import type { RealtimeTransport } from '@/realtime/transports/realtime-transport.interface';

describe('RealtimeService (Centrifugo Facade)', () => {
  let service: RealtimeService;
  let primaryTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };
  let channelManager: ChannelManager;
  let centrifugoTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    batchPublish: ReturnType<typeof vi.fn>;
    isConfigured: ReturnType<typeof vi.fn>;
    checkHealth: ReturnType<typeof vi.fn>;
    generateConnectionToken: ReturnType<typeof vi.fn>;
    generateSubscriptionToken: ReturnType<typeof vi.fn>;
    getWsUrl: ReturnType<typeof vi.fn>;
    getSseUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    primaryTransport = {
      sendToUser: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn().mockResolvedValue(undefined),
    };
    channelManager = new ChannelManager();
    centrifugoTransport = {
      sendToUser: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn().mockResolvedValue(undefined),
      batchPublish: vi.fn().mockResolvedValue(undefined),
      checkHealth: vi.fn().mockResolvedValue({
        status: 'up',
        driver: 'centrifugo',
        details: { nodes: 1, clients: 10, channels: 2, version: '5.4.0' },
      }),
      generateConnectionToken: vi.fn().mockReturnValue({ token: 'mock:conn:jwt', expiresAt: 1720000000000 }),
      generateSubscriptionToken: vi.fn().mockReturnValue({
        token: 'mock:sub:jwt',
        channel: 'private:user.01931234-0000-7000-8000-000000000001',
        expiresAt: 1720000000000,
      }),
      getWsUrl: vi.fn().mockReturnValue('ws://127.0.0.1:8000/connection/websocket'),
      getSseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000/connection/sse'),
      isConfigured: vi.fn().mockReturnValue(true),
    };

    service = new RealtimeService(
      primaryTransport as unknown as RealtimeTransport,
      channelManager,
      centrifugoTransport as unknown as CentrifugoTransport,
    );
  });

  describe('基础属性与驱动', () => {
    it('getDriver 应在传输层已配置时返回 centrifugo', () => {
      expect(service.getDriver()).toBe('centrifugo');
    });

    it('getDriver 应在未配置 REALTIME_URL 时返回 none（不谎报可用）', () => {
      centrifugoTransport.isConfigured.mockReturnValue(false);
      expect(service.getDriver()).toBe('none');
    });

    it('getCentrifugoTransport 应返回注入的 Centrifugo 实例', () => {
      expect(service.getCentrifugoTransport()).toBe(centrifugoTransport);
    });

    it('getWsUrl 与 getSseUrl 应委托给 centrifugoTransport', () => {
      expect(service.getWsUrl()).toBe('ws://127.0.0.1:8000/connection/websocket');
      expect(service.getSseUrl()).toBe('http://127.0.0.1:8000/connection/sse');
      expect(centrifugoTransport.getWsUrl).toHaveBeenCalled();
      expect(centrifugoTransport.getSseUrl).toHaveBeenCalled();
    });

    it('getActiveSocketsCount 应固定返回 0 (长连接下沉到外部网关)', () => {
      expect(service.getActiveSocketsCount()).toBe(0);
    });

    it('checkHealth 应委托给 centrifugoTransport.checkHealth', async () => {
      centrifugoTransport.checkHealth.mockResolvedValue({
        status: 'up',
        nodesCount: 1,
        totalClients: 10,
        totalChannels: 2,
      });

      const health = await service.checkHealth();
      expect(health.status).toBe('up');
      expect(health.nodesCount).toBe(1);
      expect(centrifugoTransport.checkHealth).toHaveBeenCalled();
    });

    it('当 Centrifugo 未就绪时 checkHealth 应返回 down 状态', async () => {
      const serviceWithoutCentrifugo = new RealtimeService(
        primaryTransport as unknown as RealtimeTransport,
        channelManager,
        undefined as unknown as CentrifugoTransport,
      );

      const health = await serviceWithoutCentrifugo.checkHealth();
      expect(health.status).toBe('down');
      expect(health.error).toBe('Centrifugo transport is not available');
    });
  });

  describe('事件派发', () => {
    it('sendToUser 应委托给 primaryTransport', async () => {
      const payload = { orderId: 'ORD-999', status: 'shipped' };

      const result = await service.sendToUser('01931234-0000-7000-8000-000000000042', 'order:updated', payload);

      expect(primaryTransport.sendToUser).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'order:updated',
          targetUserId: '01931234-0000-7000-8000-000000000042',
          data: payload,
        }),
      );
      expect(result.event).toBe('order:updated');
    });

    it('broadcast 应委托给 primaryTransport', async () => {
      const metric = { cpu: 80 };

      const result = await service.broadcast('system', 'metrics:updated', metric);

      expect(primaryTransport.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'metrics:updated',
          channel: 'system',
          data: metric,
        }),
      );
      expect(result.channel).toBe('system');
    });

    it('batchBroadcast 应将多个消息委托给 centrifugoTransport.batchPublish', async () => {
      const publications = [
        { channel: 'public:notices', event: 'notice', data: { text: 'test' } },
        { channel: 'room:chat-1', event: 'chat', data: { msg: 'hi' } },
      ];

      await service.batchBroadcast(publications);

      expect(centrifugoTransport.batchPublish).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            channel: 'public:notices',
            data: expect.objectContaining({ event: 'notice', channel: 'public:notices' }),
          }),
          expect.objectContaining({
            channel: 'room:chat-1',
            data: expect.objectContaining({ event: 'chat', channel: 'room:chat-1' }),
          }),
        ]),
      );
    });

    it('sendToUser 在底层 transport 异步异常时应安全降级而不抛出阻断业务', async () => {
      primaryTransport.sendToUser.mockRejectedValueOnce(new Error('Network disconnected'));

      expect(() => {
        service.sendToUser('01931234-0000-7000-8000-000000000042', 'test:event', { foo: 'bar' });
      }).not.toThrow();
    });

    it('broadcast 在底层 transport 异步异常时应安全降级而不抛出阻断业务', async () => {
      primaryTransport.broadcast.mockRejectedValueOnce(new Error('Centrifugo unreachable'));

      expect(() => {
        service.broadcast('public:chat', 'chat:message', { text: 'hello' });
      }).not.toThrow();
    });

    it('batchBroadcast 当缺少 centrifugoTransport 时应降级使用 primaryTransport.broadcast 并行广播', async () => {
      const fallbackService = new RealtimeService(
        primaryTransport as unknown as RealtimeTransport,
        channelManager,
        undefined as unknown as CentrifugoTransport,
      );

      const publications = [
        { channel: 'public:fallback-1', event: 'evt1', data: { a: 1 } },
        { channel: 'public:fallback-2', event: 'evt2', data: { b: 2 } },
      ];

      await fallbackService.batchBroadcast(publications);

      expect(primaryTransport.broadcast).toHaveBeenCalledTimes(2);
      expect(primaryTransport.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'public:fallback-1', event: 'evt1', data: { a: 1 } }),
      );
      expect(primaryTransport.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'public:fallback-2', event: 'evt2', data: { b: 2 } }),
      );
    });

    it('batchBroadcast 传入空数组时应直接返回', async () => {
      await service.batchBroadcast([]);
      expect(centrifugoTransport.batchPublish).not.toHaveBeenCalled();
    });
  });

  describe('createConnectionToken() 长连接鉴权', () => {
    const user: CurrentUserPayload = {
      id: '01931234-0000-7000-8000-000000000001',
      email: 'user@example.com',
      role: Role.USER,
    };

    it('当 Centrifugo 适配器可用时应成功返回 Connection Token', () => {
      const result = service.createConnectionToken(user);

      expect(result).toEqual({ token: 'mock:conn:jwt', expiresAt: 1720000000000 });
      expect(centrifugoTransport.generateConnectionToken).toHaveBeenCalledWith(user, undefined);
    });

    it('应支持传入自定义 ttlSeconds 并传递给底层适配器', () => {
      service.createConnectionToken(user, 3600);
      expect(centrifugoTransport.generateConnectionToken).toHaveBeenCalledWith(user, 3600);
    });

    it('当 Centrifugo 适配器未就绪时应抛出 BadRequestException', () => {
      const serviceWithoutCentrifugo = new RealtimeService(
        primaryTransport as unknown as RealtimeTransport,
        channelManager,
        undefined as unknown as CentrifugoTransport,
      );

      expect(() => serviceWithoutCentrifugo.createConnectionToken(user)).toThrow(BadRequestException);
    });
  });

  describe('authorizeSubscription() 频道订阅鉴权', () => {
    const user: CurrentUserPayload = {
      id: '01931234-0000-7000-8000-000000000001',
      email: 'user@example.com',
      role: Role.USER,
    };

    it('合法私有频道订阅应成功返回 Subscription Token', async () => {
      const result = await service.authorizeSubscription(user, {
        channel: 'private:user.01931234-0000-7000-8000-000000000001',
        client: 'client-123',
      });

      expect(result).toEqual({
        token: 'mock:sub:jwt',
        channel: 'private:user.01931234-0000-7000-8000-000000000001',
        expiresAt: 1720000000000,
      });
      expect(centrifugoTransport.generateSubscriptionToken).toHaveBeenCalledWith(
        user,
        'private:user.01931234-0000-7000-8000-000000000001',
        'client-123',
        undefined,
      );
    });

    it('应支持传入自定义 ttlSeconds 并传递给底层适配器', async () => {
      await service.authorizeSubscription(user, { channel: 'private:user.01931234-0000-7000-8000-000000000001' }, 7200);
      expect(centrifugoTransport.generateSubscriptionToken).toHaveBeenCalledWith(
        user,
        'private:user.01931234-0000-7000-8000-000000000001',
        undefined,
        7200,
      );
    });

    it('在场频道订阅校验通过后应正确签发 Token', async () => {
      channelManager.register('presence:room.default', () => true);

      await service.authorizeSubscription(user, {
        channel: 'presence:room.default',
      });

      expect(centrifugoTransport.generateSubscriptionToken).toHaveBeenCalledWith(
        user,
        'presence:room.default',
        undefined,
        undefined,
      );
    });

    it('未授权私有频道订阅应抛出 ForbiddenException', async () => {
      await expect(
        service.authorizeSubscription(user, {
          channel: 'private:user.other-user-999',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Centrifugo 适配器未就绪时应抛出 BadRequestException', async () => {
      const serviceWithoutCentrifugo = new RealtimeService(
        primaryTransport as unknown as RealtimeTransport,
        channelManager,
        undefined as unknown as CentrifugoTransport,
      );

      await expect(
        serviceWithoutCentrifugo.authorizeSubscription(user, {
          channel: 'private:user.01931234-0000-7000-8000-000000000001',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

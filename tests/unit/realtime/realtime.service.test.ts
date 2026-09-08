import { EventEmitter } from 'node:events';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { firstValueFrom, of, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import type { RealtimeGateway } from '@/realtime/realtime.gateway';
import { RealtimeService } from '@/realtime/realtime.service';
import type { PusherTransport } from '@/realtime/transports/pusher.transport';
import type { RedisPubSubAdapter } from '@/realtime/transports/redis-pubsub.adapter';
import type { SseTransport } from '@/realtime/transports/sse.transport';

describe('RealtimeService (Multi-Driver Facade)', () => {
  let service: RealtimeService;
  let primaryTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };
  let configService: { get: ReturnType<typeof vi.fn> };
  let channelManager: ChannelManager;
  let sseTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let realtimeGateway: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    getActiveSocketsCount: ReturnType<typeof vi.fn>;
  };
  let pusherTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
    authorizeChannel: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    primaryTransport = {
      sendToUser: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'BROADCAST_DRIVER') return 'local';
        return undefined;
      }),
    };
    channelManager = new ChannelManager();
    sseTransport = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
      subscribe: vi.fn(),
    };
    realtimeGateway = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
      getActiveSocketsCount: vi.fn().mockReturnValue(3),
    };
    pusherTransport = {
      sendToUser: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn().mockResolvedValue(undefined),
      getClient: vi.fn().mockReturnValue({}),
      authorizeChannel: vi.fn().mockReturnValue({ auth: 'mock:auth:sig' }),
    };

    service = new RealtimeService(
      primaryTransport as unknown as any,
      configService as unknown as ConfigService<any, true>,
      sseTransport as unknown as SseTransport,
      realtimeGateway as unknown as RealtimeGateway,
      channelManager,
      pusherTransport as unknown as PusherTransport,
    );
  });

  describe('多态传输层派发', () => {
    it('sendToUser 应委托给 primaryTransport', () => {
      const payload = { orderId: 'ORD-999', status: 'shipped' };

      const result = service.sendToUser('01931234-0000-7000-8000-000000000042', 'order:updated', payload);

      expect(primaryTransport.sendToUser).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'order:updated',
          targetUserId: '01931234-0000-7000-8000-000000000042',
          data: payload,
        }),
      );
      expect(result.event).toBe('order:updated');
    });

    it('broadcast 应委托给 primaryTransport', () => {
      const metric = { cpu: 80 };

      const result = service.broadcast('system', 'metrics:updated', metric);

      expect(primaryTransport.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'metrics:updated',
          channel: 'system',
          data: metric,
        }),
      );
      expect(result.channel).toBe('system');
    });
  });

  describe('authenticatePusher() 频道鉴权', () => {
    const user: CurrentUserPayload = {
      id: '01931234-0000-7000-8000-000000000001',
      email: 'user@example.com',
      role: Role.USER,
    };

    it('合法私有频道订阅应成功返回签名', async () => {
      const sig = await service.authenticatePusher(user, {
        socket_id: '123.456',
        channel_name: 'private-user.01931234-0000-7000-8000-000000000001',
      });

      expect(sig).toEqual({ auth: 'mock:auth:sig' });
      expect(pusherTransport.authorizeChannel).toHaveBeenCalledWith(
        '123.456',
        'private-user.01931234-0000-7000-8000-000000000001',
        undefined,
      );
    });

    it('在场频道订阅应正确传递 presenceData 用户信息', async () => {
      // 注册在场频道授权规则（在场频道同样需要显式规则，与 private 一致 — Fail-Closed 策略）
      channelManager.register('presence:room.default', () => true);

      await service.authenticatePusher(user, {
        socket_id: '123.456',
        channel_name: 'presence:room.default',
      });

      expect(pusherTransport.authorizeChannel).toHaveBeenCalledWith('123.456', 'presence:room.default', {
        user_id: '01931234-0000-7000-8000-000000000001',
        user_info: { email: 'user@example.com', role: Role.USER },
      });
    });

    it('未授权私有频道订阅应抛出 ForbiddenException', async () => {
      await expect(
        service.authenticatePusher(user, {
          socket_id: '123.456',
          channel_name: 'private-user.99',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Pusher 驱动未就绪时应抛出 BadRequestException', async () => {
      pusherTransport.getClient.mockReturnValue(null);

      await expect(
        service.authenticatePusher(user, {
          socket_id: '123.456',
          channel_name: 'private-user.01931234-0000-7000-8000-000000000001',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createSseStream() 标准流生命周期', () => {
    it('应首先发出 connected 首包并在 close 时安全释放', async () => {
      sseTransport.subscribe.mockReturnValue(of());
      const mockRaw = new EventEmitter();
      const mockReq = { raw: mockRaw } as any;
      const user: CurrentUserPayload = {
        id: '01931234-0000-7000-8000-000000000001',
        email: 'u@example.com',
        role: Role.USER,
      };

      const stream$ = service.createSseStream(user, mockReq);
      const messagesPromise = firstValueFrom(stream$.pipe(toArray()));

      mockRaw.emit('close');

      const messages = await messagesPromise;
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0].type).toBe('connected');
    });
  });
});

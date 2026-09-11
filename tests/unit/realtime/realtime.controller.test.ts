import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { RealtimeChannelsService } from '@/realtime/channels/realtime-channels.service';
import { RealtimeController } from '@/realtime/realtime.controller';
import type { RealtimeEventsService } from '@/realtime/realtime-events.service';

describe('RealtimeController', () => {
  let controller: RealtimeController;
  let mockEventsService: {
    createConnectionToken: ReturnType<typeof vi.fn>;
    subscribeChannel: ReturnType<typeof vi.fn>;
  };
  let mockChannelsService: {
    listRegisteredChannels: ReturnType<typeof vi.fn>;
  };

  const mockUser: CurrentUserPayload = {
    id: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.USER,
  };

  beforeEach(() => {
    mockEventsService = {
      createConnectionToken: vi.fn().mockImplementation((_user, protocol = 'websocket') => ({
        token: 'test-token',
        url: protocol === 'sse' ? 'http://127.0.0.1:8000/connection/sse' : 'ws://127.0.0.1:8000/connection/websocket',
        protocol,
      })),
      subscribeChannel: vi.fn().mockResolvedValue({ token: 'sub-token-abc' }),
    };

    mockChannelsService = {
      listRegisteredChannels: vi
        .fn()
        .mockReturnValue([{ pattern: 'private:notifications.{userId}', description: '用户通知', isPrivate: true }]),
    };

    controller = new RealtimeController(
      mockEventsService as unknown as RealtimeEventsService,
      mockChannelsService as unknown as RealtimeChannelsService,
    );
  });

  describe('createConnectionToken', () => {
    it('默认未指定协议且非 SSE 路径时，应默认签发 websocket 凭证', () => {
      const result = controller.createConnectionToken(mockUser, {});
      expect(mockEventsService.createConnectionToken).toHaveBeenCalledWith(mockUser, 'websocket');
      expect(result.protocol).toBe('websocket');
      expect(result.url).toContain('/connection/websocket');
    });

    it('显式传入 ?protocol=sse 时，应签发 sse 协议凭证', () => {
      const result = controller.createConnectionToken(mockUser, { protocol: 'sse' });
      expect(mockEventsService.createConnectionToken).toHaveBeenCalledWith(mockUser, 'sse');
      expect(result.protocol).toBe('sse');
      expect(result.url).toContain('/connection/sse');
    });

    it('通过兼容路径 /v1/sse/token 请求时，即使未传 query 也能智能推导为 sse 协议', () => {
      const mockReq = { url: '/v1/sse/token' } as FastifyRequest;
      const result = controller.createConnectionToken(mockUser, {}, mockReq);
      expect(mockEventsService.createConnectionToken).toHaveBeenCalledWith(mockUser, 'sse');
      expect(result.protocol).toBe('sse');
    });

    it('通过兼容路径 /v1/websocket/token 请求时，应签发 websocket 凭证', () => {
      const mockReq = { url: '/v1/websocket/token' } as FastifyRequest;
      const result = controller.createConnectionToken(mockUser, {}, mockReq);
      expect(mockEventsService.createConnectionToken).toHaveBeenCalledWith(mockUser, 'websocket');
      expect(result.protocol).toBe('websocket');
    });
  });

  describe('subscribe', () => {
    it('应成功调用订阅鉴权服务并返回订阅 Token', async () => {
      const dto = {
        channel: 'private:notifications.user_123',
        client: 'client_xyz',
      };

      const result = await controller.subscribe(mockUser, dto);
      expect(mockEventsService.subscribeChannel).toHaveBeenCalledWith(mockUser, dto.channel, dto.client);
      expect(result.token).toBe('sub-token-abc');
    });
  });

  describe('listChannels', () => {
    it('应返回所有注册的频道清单', () => {
      const result = controller.listChannels();
      expect(mockChannelsService.listRegisteredChannels).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].pattern).toBe('private:notifications.{userId}');
    });
  });
});

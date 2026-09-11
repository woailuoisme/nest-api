import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { WebsocketController } from '@/features/system/websocket/websocket.controller';
import type { WebsocketService } from '@/features/system/websocket/websocket.service';
import type { WebsocketChannelsService } from '@/features/system/websocket/websocket-channels.service';

describe('WebsocketController', () => {
  let controller: WebsocketController;
  let mockWebsocketService: {
    createConnectionToken: ReturnType<typeof vi.fn>;
    subscribeChannel: ReturnType<typeof vi.fn>;
  };
  let mockChannelsService: {
    listRegisteredChannels: ReturnType<typeof vi.fn>;
  };

  const mockUser: CurrentUserPayload = {
    id: 'user-uuid-1',
    email: 'user@example.com',
    role: Role.USER,
  };

  beforeEach(() => {
    mockWebsocketService = {
      createConnectionToken: vi.fn().mockReturnValue({
        token: 'token-abc',
        url: 'ws://127.0.0.1:8000/connection/websocket',
      }),
      subscribeChannel: vi.fn().mockResolvedValue({ token: 'sub-token-xyz' }),
    };
    mockChannelsService = {
      listRegisteredChannels: vi
        .fn()
        .mockReturnValue([{ pattern: 'private:ws:notifications.{userId}', description: '用户通知', isPrivate: true }]),
    };
    controller = new WebsocketController(
      mockWebsocketService as unknown as WebsocketService,
      mockChannelsService as unknown as WebsocketChannelsService,
    );
  });

  it('createConnectionToken 应签发连接凭证', () => {
    const result = controller.createConnectionToken(mockUser);
    expect(mockWebsocketService.createConnectionToken).toHaveBeenCalledWith(mockUser);
    expect(result.token).toBe('token-abc');
  });

  it('subscribe 应执行订阅授权并返回 token', async () => {
    const result = await controller.subscribe(mockUser, {
      channel: 'private:ws:notifications.user-uuid-1',
      client: 'client-1',
    });
    expect(mockWebsocketService.subscribeChannel).toHaveBeenCalledWith(
      mockUser,
      'private:ws:notifications.user-uuid-1',
      'client-1',
    );
    expect(result.token).toBe('sub-token-xyz');
  });

  it('listChannels 应返回频道清单', () => {
    const list = controller.listChannels();
    expect(list).toHaveLength(1);
    expect(list[0].pattern).toBe('private:ws:notifications.{userId}');
  });
});

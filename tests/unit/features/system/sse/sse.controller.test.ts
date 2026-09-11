import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { SseController } from '@/features/system/sse/sse.controller';
import type { SseService } from '@/features/system/sse/sse.service';
import type { SseChannelsService } from '@/features/system/sse/sse-channels.service';

describe('SseController', () => {
  let controller: SseController;
  let mockSseService: {
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
    mockSseService = {
      createConnectionToken: vi.fn().mockReturnValue({
        token: 'token-sse-123',
        url: 'http://127.0.0.1:8000/connection/sse',
      }),
      subscribeChannel: vi.fn().mockResolvedValue({ token: 'sub-token-sse-abc' }),
    };
    mockChannelsService = {
      listRegisteredChannels: vi
        .fn()
        .mockReturnValue([
          { pattern: 'private:sse:notifications.{userId}', description: 'SSE用户通知', isPrivate: true },
        ]),
    };
    controller = new SseController(
      mockSseService as unknown as SseService,
      mockChannelsService as unknown as SseChannelsService,
    );
  });

  it('createConnectionToken 应签发 SSE 连接凭据', () => {
    const result = controller.createConnectionToken(mockUser);
    expect(mockSseService.createConnectionToken).toHaveBeenCalledWith(mockUser);
    expect(result.token).toBe('token-sse-123');
  });

  it('subscribe 应执行订阅授权并返回 token', async () => {
    const result = await controller.subscribe(mockUser, {
      channel: 'private:sse:notifications.user-uuid-1',
      client: 'client-sse-1',
    });
    expect(mockSseService.subscribeChannel).toHaveBeenCalledWith(
      mockUser,
      'private:sse:notifications.user-uuid-1',
      'client-sse-1',
    );
    expect(result.token).toBe('sub-token-sse-abc');
  });

  it('listChannels 应返回 SSE 频道清单', () => {
    const list = controller.listChannels();
    expect(list).toHaveLength(1);
    expect(list[0].pattern).toBe('private:sse:notifications.{userId}');
  });
});

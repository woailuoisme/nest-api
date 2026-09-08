import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '@/api/admin/notifications/notifications.service';
import type { RealtimeService } from '@/realtime/realtime.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockRealtimeService: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRealtimeService = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };
    service = new NotificationsService(mockRealtimeService as unknown as RealtimeService);
  });

  it('sendToUser 应组装结构化负载并委托给 RealtimeService.sendToUser', () => {
    const payload = service.sendToUser('user-uuid-1', {
      title: '账户变动',
      message: '您的密码已修改',
      type: 'warning',
    });

    expect(mockRealtimeService.sendToUser).toHaveBeenCalledWith(
      'user-uuid-1',
      'notification',
      expect.objectContaining({
        title: '账户变动',
        message: '您的密码已修改',
        type: 'warning',
      }),
    );
    expect(payload.title).toBe('账户变动');
  });

  it('broadcast 应组装结构化负载并委托给 RealtimeService.broadcast', () => {
    const payload = service.broadcast({
      title: '系统维护',
      message: '系统将于今晚 24:00 维护',
      type: 'info',
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'notifications',
      'notification',
      expect.objectContaining({
        title: '系统维护',
        message: '系统将于今晚 24:00 维护',
        type: 'info',
      }),
    );
    expect(payload.title).toBe('系统维护');
  });
});

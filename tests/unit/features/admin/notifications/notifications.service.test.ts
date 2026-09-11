import type { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '@/features/admin/notifications/notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockEventEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockEventEmitter = {
      emit: vi.fn(),
    };
    service = new NotificationsService(mockEventEmitter as unknown as EventEmitter2);
  });

  it('sendToUser 应组装结构化负载并通过事件总线触发 notification.sent', () => {
    const payload = service.sendToUser('user-uuid-1', {
      title: '账户变动',
      message: '您的密码已修改',
      type: 'warning',
    });

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification.sent',
      expect.objectContaining({
        userId: 'user-uuid-1',
        payload: expect.objectContaining({
          title: '账户变动',
          message: '您的密码已修改',
          type: 'warning',
        }),
      }),
    );
    expect(payload.title).toBe('账户变动');
  });

  it('broadcast 应组装结构化负载并通过事件总线触发 notification.broadcast', () => {
    const payload = service.broadcast({
      title: '系统维护',
      message: '系统将于今晚 24:00 维护',
      type: 'info',
    });

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification.broadcast',
      expect.objectContaining({
        payload: expect.objectContaining({
          title: '系统维护',
          message: '系统将于今晚 24:00 维护',
          type: 'info',
        }),
      }),
    );
    expect(payload.title).toBe('系统维护');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminNotificationsController } from '@/api/admin/notifications/notifications.controller';
import type { NotificationsService } from '@/api/admin/notifications/notifications.service';

describe('AdminNotificationsController', () => {
  let controller: AdminNotificationsController;
  let service: {
    sendToUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      sendToUser: vi.fn(),
    };
    controller = new AdminNotificationsController(service as unknown as NotificationsService);
  });

  describe('send()', () => {
    it('应调用 notificationsService.sendToUser 派发事件并返回裸负载交由全局拦截器包装', () => {
      const dto = {
        userId: 'user-uuid-42',
        title: '订单发货',
        message: '您的订单已发货',
        type: 'info' as const,
      };
      const notificationPayload = {
        id: 'uuid-1',
        title: '订单发货',
        message: '您的订单已发货',
        type: 'info',
        timestamp: 1700000000000,
      };
      service.sendToUser.mockReturnValue(notificationPayload);

      const result = controller.send(dto);

      expect(service.sendToUser).toHaveBeenCalledWith('user-uuid-42', {
        title: '订单发货',
        message: '您的订单已发货',
        type: 'info',
        metadata: undefined,
      });
      expect(result).toBe(notificationPayload);
    });
  });
});

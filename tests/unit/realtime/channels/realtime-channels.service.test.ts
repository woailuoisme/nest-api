import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { REALTIME_CHANNELS, RealtimeChannelsService } from '@/realtime/channels/realtime-channels.service';

describe('RealtimeChannelsService', () => {
  let service: RealtimeChannelsService;
  const mockUser: CurrentUserPayload = {
    id: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.USER,
  };

  beforeEach(() => {
    service = new RealtimeChannelsService();
  });

  describe('用户专属通知频道鉴权', () => {
    it('规范模式：当用户 ID 与参数匹配时授权成功', () => {
      const allowed = service.authorizeUserNotification(mockUser, { userId: 'user_123' });
      expect(allowed).toBe(true);
    });

    it('规范模式：当用户 ID 与参数不匹配时拒绝授权', () => {
      const allowed = service.authorizeUserNotification(mockUser, { userId: 'other_user' });
      expect(allowed).toBe(false);
    });

    it('兼容模式 (WebSocket)：当用户 ID 与参数匹配时授权成功', () => {
      const allowed = service.authorizeWsUserNotification(mockUser, { userId: 'user_123' });
      expect(allowed).toBe(true);
    });

    it('兼容模式 (SSE)：当用户 ID 与参数匹配时授权成功', () => {
      const allowed = service.authorizeSseUserNotification(mockUser, { userId: 'user_123' });
      expect(allowed).toBe(true);
    });

    it('缺少参数或用户未登录时拒绝授权', () => {
      expect(service.authorizeUserNotification(null as unknown as CurrentUserPayload, { userId: 'user_123' })).toBe(
        false,
      );
      expect(service.authorizeUserNotification(mockUser, null as unknown as Record<string, string>)).toBe(false);
    });
  });

  describe('工业设备遥测推流频道鉴权', () => {
    it('规范模式：合法用户且具备 deviceId 时允许订阅', () => {
      const allowed = service.authorizeDeviceTelemetry(mockUser, { deviceId: 'dev_001' });
      expect(allowed).toBe(true);
    });

    it('规范模式：未传 deviceId 或未登录时拒绝订阅', () => {
      expect(service.authorizeDeviceTelemetry(mockUser, {} as Record<string, string>)).toBe(false);
      expect(service.authorizeDeviceTelemetry(null as unknown as CurrentUserPayload, { deviceId: 'dev_001' })).toBe(
        false,
      );
    });

    it('兼容模式 (WebSocket / SSE)：具备 deviceId 时允许订阅', () => {
      expect(service.authorizeWsDeviceTelemetry(mockUser, { deviceId: 'dev_001' })).toBe(true);
      expect(service.authorizeSseDeviceTelemetry(mockUser, { deviceId: 'dev_001' })).toBe(true);
    });
  });

  describe('工业设备告警广播频道鉴权', () => {
    it('规范模式：登录用户允许订阅告警频道', () => {
      expect(service.authorizeIotAlarms(mockUser)).toBe(true);
    });

    it('规范模式：未登录用户拒绝订阅', () => {
      expect(service.authorizeIotAlarms(null as unknown as CurrentUserPayload)).toBe(false);
    });

    it('兼容模式 (WebSocket / SSE)：登录用户允许订阅', () => {
      expect(service.authorizeWsIotAlarms(mockUser)).toBe(true);
      expect(service.authorizeSseIotAlarms(mockUser)).toBe(true);
    });
  });

  describe('listRegisteredChannels', () => {
    it('应完整返回包含规范模式与兼容模式的频道定义清单', () => {
      const channels = service.listRegisteredChannels();
      expect(channels.length).toBeGreaterThanOrEqual(12);

      const canonicalUserChannel = channels.find((c) => c.pattern === REALTIME_CHANNELS.USER_NOTIFICATION);
      expect(canonicalUserChannel).toBeDefined();
      expect(canonicalUserChannel?.isPrivate).toBe(true);

      const broadcastChannel = channels.find((c) => c.pattern === REALTIME_CHANNELS.BROADCAST_NOTIFICATION);
      expect(broadcastChannel).toBeDefined();
      expect(broadcastChannel?.isPrivate).toBe(false);

      const wsUserChannel = channels.find((c) => c.pattern === REALTIME_CHANNELS.WS_USER_NOTIFICATION);
      expect(wsUserChannel).toBeDefined();

      const sseUserChannel = channels.find((c) => c.pattern === REALTIME_CHANNELS.SSE_USER_NOTIFICATION);
      expect(sseUserChannel).toBeDefined();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { Database } from '@/database/drizzle/database';
import type { RealtimeService } from '@/realtime';
import { REALTIME_CHANNELS } from '@/realtime/channels/realtime-channels.service';
import { RealtimeEventsService } from '@/realtime/realtime-events.service';

describe('RealtimeEventsService', () => {
  let service: RealtimeEventsService;
  let mockRealtimeService: {
    createConnectionToken: ReturnType<typeof vi.fn>;
    authorizeSubscription: ReturnType<typeof vi.fn>;
    canSubscribe: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    sendToUser: ReturnType<typeof vi.fn>;
    getWsUrl: ReturnType<typeof vi.fn>;
    getSseUrl: ReturnType<typeof vi.fn>;
  };

  let mockDb: { query: { user: { findFirst: ReturnType<typeof vi.fn> } } };

  const mockUser: CurrentUserPayload = {
    id: 'usr_abc123',
    email: 'test@example.com',
    name: 'Test',
    role: Role.USER,
  };

  beforeEach(() => {
    mockRealtimeService = {
      createConnectionToken: vi.fn().mockReturnValue({
        token: 'fake-jwt-token',
        expiresAt: 123456789,
      }),
      authorizeSubscription: vi.fn().mockResolvedValue({
        token: 'fake-sub-token',
      }),
      canSubscribe: vi.fn().mockResolvedValue({ authorized: true }),
      broadcast: vi.fn().mockResolvedValue(undefined),
      sendToUser: vi.fn().mockResolvedValue(undefined),
      getWsUrl: vi.fn().mockReturnValue('ws://127.0.0.1:8000/connection/websocket'),
      getSseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000/connection/sse'),
    };

    mockDb = {
      query: {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    };

    service = new RealtimeEventsService(
      mockRealtimeService as unknown as RealtimeService,
      mockDb as unknown as Database,
    );
  });

  describe('createConnectionToken', () => {
    it('默认协议为 websocket，应返回 WebSocket 连接地址与凭据', () => {
      const result = service.createConnectionToken(mockUser);
      expect(mockRealtimeService.createConnectionToken).toHaveBeenCalledWith(mockUser);
      expect(result.token).toBe('fake-jwt-token');
      expect(result.url).toContain('/connection/websocket');
      expect(result.protocol).toBe('websocket');
    });

    it('显式指定 sse 协议时，应返回 SSE 连接地址与凭据', () => {
      const result = service.createConnectionToken(mockUser, 'sse');
      expect(mockRealtimeService.createConnectionToken).toHaveBeenCalledWith(mockUser);
      expect(result.token).toBe('fake-jwt-token');
      expect(result.url).toContain('/connection/sse');
      expect(result.protocol).toBe('sse');
    });
  });

  describe('subscribeChannel', () => {
    it('应委托底层 RealtimeService 完成私有频道订阅鉴权', async () => {
      const result = await service.subscribeChannel(mockUser, 'private:notifications.usr_abc123', 'client_1');
      expect(mockRealtimeService.authorizeSubscription).toHaveBeenCalledWith(mockUser, {
        channel: 'private:notifications.usr_abc123',
        client: 'client_1',
      });
      expect(result.token).toBe('fake-sub-token');
    });
  });

  describe('handleProxySubscribe', () => {
    it('当鉴权通过时，应返回成功的 result 空对象，且身份取自数据库', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'usr_abc123', email: 'test@example.com', role: Role.USER });
      mockRealtimeService.canSubscribe.mockResolvedValueOnce({ authorized: true });
      const result = await service.handleProxySubscribe({
        channel: 'private:notifications.usr_abc123',
        user: 'usr_abc123',
        client: 'client-1',
      });

      expect(mockRealtimeService.canSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'usr_abc123', role: Role.USER }),
        'private:notifications.usr_abc123',
      );
      expect(result).toEqual({ result: {} });
    });

    it('未知用户应直接拒绝，且不得进入频道鉴权', async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);

      const result = await service.handleProxySubscribe({
        channel: 'private:admin.orders',
        user: 'ghost-user',
      });

      expect(mockRealtimeService.canSubscribe).not.toHaveBeenCalled();
      expect(result).toEqual({ error: { code: 103, message: 'Permission denied' } });
    });

    it('未携带用户标识时应直接拒绝', async () => {
      const result = await service.handleProxySubscribe({ channel: 'private:admin.orders', user: '' });

      expect(mockRealtimeService.canSubscribe).not.toHaveBeenCalled();
      expect(result).toEqual({ error: { code: 103, message: 'Unauthenticated' } });
    });

    it('当鉴权拒绝时，应返回包含 103 错误码的标准 error 对象', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'usr_regular', email: 'u@example.com', role: Role.USER });
      mockRealtimeService.canSubscribe.mockResolvedValueOnce({
        authorized: false,
        reason: 'Forbidden to join channel',
      });
      const result = await service.handleProxySubscribe({
        channel: 'private:admin.orders',
        user: 'usr_regular',
      });

      expect(result).toEqual({
        error: {
          code: 103,
          message: 'Forbidden to join channel',
        },
      });
    });
  });

  describe('handleNotificationSent', () => {
    const mockPayload = {
      id: 'notif_123',
      title: '系统通知',
      message: '测试内容',
      type: 'system',
      timestamp: 1710000000000,
    };

    it('应通过底层 sendToUser 推送单播通知，消除多重冗余广播', async () => {
      await service.handleNotificationSent({
        userId: 'usr_abc123',
        payload: mockPayload,
      });

      // 仅通过 sendToUser 单播推流
      expect(mockRealtimeService.sendToUser).toHaveBeenCalledWith('usr_abc123', 'notification', mockPayload);
      expect(mockRealtimeService.broadcast).not.toHaveBeenCalled();
    });

    it('当缺少 userId 时静默忽略', async () => {
      await service.handleNotificationSent({
        userId: '',
        payload: mockPayload,
      });
      expect(mockRealtimeService.broadcast).not.toHaveBeenCalled();
      expect(mockRealtimeService.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('handleNotificationBroadcast', () => {
    const mockPayload = {
      id: 'notif_broadcast',
      title: '全服维护',
      message: '系统维护通知',
      type: 'broadcast',
      timestamp: 1710000000000,
    };

    it('应仅向规范广播频道推送，不产生重复推流', async () => {
      await service.handleNotificationBroadcast({
        payload: mockPayload,
      });

      expect(mockRealtimeService.broadcast).toHaveBeenCalledTimes(1);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
        REALTIME_CHANNELS.BROADCAST_NOTIFICATION,
        'notification',
        mockPayload,
      );
    });
  });

  describe('IoT 领域事件转发', () => {
    const now = 1710000000000;
    const mockTelemetry = {
      voltage: 220,
      current: 5.2,
      temperature: 36.5,
      vibration: 0.12,
      status: 'running' as const,
      timestamp: now,
    };

    it('handleIotTelemetry 应向规范设备频道单一广播遥测数据', async () => {
      const telemetryEvent = {
        deviceId: 'dev_100',
        tenantId: 'tenant_1',
        telemetry: mockTelemetry,
        timestamp: now,
      };
      await service.handleIotTelemetry(telemetryEvent);

      const canonical = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledTimes(1);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonical, 'telemetry', telemetryEvent);
    });

    it('handleIotStatusChanged 应向规范设备频道单一广播状态变更', async () => {
      const statusEvent = {
        deviceId: 'dev_100',
        tenantId: 'tenant_1',
        status: 'online' as const,
        reason: 'connected',
        timestamp: now,
      };
      await service.handleIotStatusChanged(statusEvent);

      const canonical = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledTimes(1);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonical, 'status', statusEvent);
    });

    it('handleIotAlarmTriggered 应向设备频道与系统告警中枢频道广播', async () => {
      const alarmEvent = {
        deviceId: 'dev_100',
        tenantId: 'tenant_1',
        level: 'critical' as const,
        metric: 'temperature',
        value: 85,
        threshold: 80,
        message: '超温告警 85°C',
        timestamp: now,
      };

      await service.handleIotAlarmTriggered(alarmEvent);

      const canonicalDevice = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledTimes(2);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonicalDevice, 'alarm', alarmEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(REALTIME_CHANNELS.IOT_ALARMS, 'alarm', alarmEvent);
    });

    it('handleIotCommandExecuted 应向设备专属频道广播指令执行回执', async () => {
      const commandEvent = {
        deviceId: 'dev_100',
        command: 'REBOOT',
        success: true,
        elapsedMs: 150,
        timestamp: now,
      };

      await service.handleIotCommandExecuted(commandEvent);

      const canonical = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledTimes(1);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonical, 'command_receipt', commandEvent);
    });
  });

  describe('broadcast & sendToUser 辅助方法', () => {
    it('broadcast 应透传调用底层 RealtimeService', async () => {
      await service.broadcast('test:channel', 'test:event', { foo: 'bar' });
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('test:channel', 'test:event', { foo: 'bar' });
    });

    it('sendToUser 应透传调用底层 RealtimeService', async () => {
      await service.sendToUser('user_1', 'test:event', { foo: 'bar' });
      expect(mockRealtimeService.sendToUser).toHaveBeenCalledWith('user_1', 'test:event', { foo: 'bar' });
    });
  });
});

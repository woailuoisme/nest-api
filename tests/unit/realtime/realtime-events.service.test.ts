import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { RealtimeService } from '@/realtime';
import { REALTIME_CHANNELS } from '@/realtime/channels/realtime-channels.service';
import { RealtimeEventsService } from '@/realtime/realtime-events.service';

describe('RealtimeEventsService', () => {
  let service: RealtimeEventsService;
  let mockRealtimeService: {
    createConnectionToken: ReturnType<typeof vi.fn>;
    authorizeSubscription: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    sendToUser: ReturnType<typeof vi.fn>;
    getWsUrl: ReturnType<typeof vi.fn>;
    getSseUrl: ReturnType<typeof vi.fn>;
  };

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
      broadcast: vi.fn().mockResolvedValue(undefined),
      sendToUser: vi.fn().mockResolvedValue(undefined),
      getWsUrl: vi.fn().mockReturnValue('ws://127.0.0.1:8000/connection/websocket'),
      getSseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000/connection/sse'),
    };

    service = new RealtimeEventsService(mockRealtimeService as unknown as RealtimeService);
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

  describe('handleNotificationSent', () => {
    const mockPayload = {
      id: 'notif_123',
      title: '系统通知',
      message: '测试内容',
      type: 'system',
      timestamp: 1710000000000,
    };

    it('应同时向规范频道、历史兼容频道与底层 sendToUser 推送单播通知', async () => {
      await service.handleNotificationSent({
        userId: 'usr_abc123',
        payload: mockPayload,
      });

      // 规范频道
      const canonical = REALTIME_CHANNELS.USER_NOTIFICATION.replace('{userId}', 'usr_abc123');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonical, 'notification', mockPayload);

      // 兼容 ws 频道
      const wsChannel = REALTIME_CHANNELS.WS_USER_NOTIFICATION.replace('{userId}', 'usr_abc123');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(wsChannel, 'notification', mockPayload);

      // 兼容 sse 频道
      const sseChannel = REALTIME_CHANNELS.SSE_USER_NOTIFICATION.replace('{userId}', 'usr_abc123');
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(sseChannel, 'notification', mockPayload);

      // sendToUser
      expect(mockRealtimeService.sendToUser).toHaveBeenCalledWith('usr_abc123', 'notification', mockPayload);
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

    it('应同时向规范广播频道与兼容广播频道推送', async () => {
      await service.handleNotificationBroadcast({
        payload: mockPayload,
      });

      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
        REALTIME_CHANNELS.BROADCAST_NOTIFICATION,
        'notification',
        mockPayload,
      );
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
        REALTIME_CHANNELS.WS_BROADCAST_NOTIFICATION,
        'notification',
        mockPayload,
      );
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
        REALTIME_CHANNELS.SSE_BROADCAST_NOTIFICATION,
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

    it('handleIotTelemetry 应向规范设备频道及兼容频道广播遥测数据', async () => {
      const telemetryEvent = {
        deviceId: 'dev_100',
        tenantId: 'tenant_1',
        telemetry: mockTelemetry,
        timestamp: now,
      };
      await service.handleIotTelemetry(telemetryEvent);

      const canonical = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      const wsChannel = REALTIME_CHANNELS.WS_DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
      const sseChannel = REALTIME_CHANNELS.SSE_DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');

      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonical, 'telemetry', telemetryEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(wsChannel, 'telemetry', telemetryEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(sseChannel, 'telemetry', telemetryEvent);
    });

    it('handleIotStatusChanged 应向规范设备频道及兼容频道广播状态变更', async () => {
      const statusEvent = {
        deviceId: 'dev_100',
        tenantId: 'tenant_1',
        status: 'online' as const,
        reason: 'connected',
        timestamp: now,
      };
      await service.handleIotStatusChanged(statusEvent);

      const canonical = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', 'dev_100');
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
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(canonicalDevice, 'alarm', alarmEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(REALTIME_CHANNELS.IOT_ALARMS, 'alarm', alarmEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(REALTIME_CHANNELS.WS_IOT_ALARMS, 'alarm', alarmEvent);
      expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(REALTIME_CHANNELS.SSE_IOT_ALARMS, 'alarm', alarmEvent);
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

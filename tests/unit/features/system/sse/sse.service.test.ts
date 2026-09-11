import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { RealtimeService } from '@/common/realtime/realtime.service';
import { SseService } from '@/features/system/sse/sse.service';

describe('SseService', () => {
  let service: SseService;
  let mockRealtimeService: {
    createConnectionToken: ReturnType<typeof vi.fn>;
    authorizeSubscription: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
    sendToUser: ReturnType<typeof vi.fn>;
    getSseUrl: ReturnType<typeof vi.fn>;
  };

  const mockUser: CurrentUserPayload = {
    id: 'user-uuid-1',
    email: 'user@example.com',
    role: Role.USER,
  };

  beforeEach(() => {
    mockRealtimeService = {
      createConnectionToken: vi.fn().mockReturnValue({ token: 'mock-sse-token' }),
      authorizeSubscription: vi.fn().mockResolvedValue({ token: 'mock-sub-token' }),
      broadcast: vi.fn().mockResolvedValue(undefined),
      sendToUser: vi.fn().mockResolvedValue(undefined),
      getSseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000/connection/sse'),
    };
    service = new SseService(mockRealtimeService as unknown as RealtimeService);
  });

  it('createConnectionToken 应正确委托 RealtimeService 并返回包含 SSE url 的 DTO', () => {
    const result = service.createConnectionToken(mockUser);
    expect(mockRealtimeService.createConnectionToken).toHaveBeenCalledWith(mockUser);
    expect(result.token).toBe('mock-sse-token');
    expect(result.url).toContain('/connection/sse');
  });

  it('subscribeChannel 应正确委托 RealtimeService.authorizeSubscription', async () => {
    const result = await service.subscribeChannel(mockUser, 'private:sse:notifications.user-uuid-1', 'client-sse-1');
    expect(mockRealtimeService.authorizeSubscription).toHaveBeenCalledWith(mockUser, {
      channel: 'private:sse:notifications.user-uuid-1',
      client: 'client-sse-1',
    });
    expect(result.token).toBe('mock-sub-token');
  });

  it('handleNotificationSent 应同时向 SSE 专属频道与底层 sendToUser 推送', async () => {
    await service.handleNotificationSent({
      userId: 'user-uuid-1',
      payload: {
        id: 'msg-1',
        title: '测试',
        message: '内容',
        type: 'info',
        timestamp: 123456789,
      },
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'private:sse:notifications.user-uuid-1',
      'notification',
      expect.objectContaining({ id: 'msg-1' }),
    );
    expect(mockRealtimeService.sendToUser).toHaveBeenCalledWith(
      'user-uuid-1',
      'notification',
      expect.objectContaining({ id: 'msg-1' }),
    );
  });

  it('handleNotificationBroadcast 应向 SSE 广播频道推送', async () => {
    await service.handleNotificationBroadcast({
      payload: {
        id: 'broadcast-1',
        title: '全员广播',
        message: '广播内容',
        type: 'info',
        timestamp: 123456789,
      },
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'sse:notifications',
      'notification',
      expect.objectContaining({ id: 'broadcast-1' }),
    );
  });

  it('handleIotTelemetry 应向设备专属 SSE 频道广播遥测数据', async () => {
    await service.handleIotTelemetry({
      tenantId: 'tenant-1',
      deviceId: 'plc-1',
      telemetry: {
        voltage: 220,
        current: 5,
        temperature: 40,
        vibration: 0.5,
        status: 'running',
      },
      timestamp: 123456789,
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'sse:devices.plc-1',
      'telemetry',
      expect.objectContaining({
        deviceId: 'plc-1',
        tenantId: 'tenant-1',
      }),
    );
  });

  it('handleIotStatusChanged 应向设备专属 SSE 频道广播状态变更', async () => {
    await service.handleIotStatusChanged({
      tenantId: 'tenant-1',
      deviceId: 'plc-1',
      status: 'offline',
      reason: 'LWT',
      timestamp: 123456789,
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'sse:devices.plc-1',
      'status',
      expect.objectContaining({
        deviceId: 'plc-1',
        status: 'offline',
      }),
    );
  });

  it('handleIotAlarmTriggered 应同时向设备专属频道与全局 IoT 告警 SSE 频道广播', async () => {
    const alarmEvent = {
      tenantId: 'tenant-1',
      deviceId: 'plc-1',
      level: 'critical' as const,
      metric: 'temperature',
      value: 90,
      threshold: 85,
      message: 'Critical temperature',
      timestamp: 123456789,
    };

    await service.handleIotAlarmTriggered(alarmEvent);

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('sse:devices.plc-1', 'alarm', alarmEvent);
    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('sse:iot:alarms', 'alarm', alarmEvent);
  });

  it('handleIotCommandExecuted 应向设备专属 SSE 频道广播指令执行回执', async () => {
    await service.handleIotCommandExecuted({
      deviceId: 'plc-1',
      command: 'startMotor',
      success: true,
      elapsedMs: 25,
      timestamp: 123456789,
    });

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith(
      'sse:devices.plc-1',
      'command_receipt',
      expect.objectContaining({
        deviceId: 'plc-1',
        command: 'startMotor',
        success: true,
      }),
    );
  });
});

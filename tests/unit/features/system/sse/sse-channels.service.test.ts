import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { SSE_CHANNELS, SseChannelsService } from '@/features/system/sse/sse-channels.service';

describe('SseChannelsService', () => {
  let service: SseChannelsService;

  beforeEach(() => {
    service = new SseChannelsService();
  });

  const mockUser: CurrentUserPayload = {
    id: 'user-uuid-1',
    email: 'test@example.com',
    role: Role.USER,
  };

  it('listRegisteredChannels 应返回所有 SSE 频道的元数据', () => {
    const list = service.listRegisteredChannels();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.map((c) => c.pattern)).toContain(SSE_CHANNELS.USER_NOTIFICATION);
    expect(list.map((c) => c.pattern)).toContain(SSE_CHANNELS.BROADCAST_NOTIFICATION);
    expect(list.map((c) => c.pattern)).toContain(SSE_CHANNELS.DEVICE_TELEMETRY);
    expect(list.map((c) => c.pattern)).toContain(SSE_CHANNELS.IOT_ALARMS);
  });

  it('用户可以成功订阅自己的私有 SSE 通知频道', async () => {
    const result = await service.authorizeUserNotification(mockUser, { userId: 'user-uuid-1' });
    expect(result).toBe(true);
  });

  it('用户不能订阅其他用户的私有 SSE 通知频道', async () => {
    const result = await service.authorizeUserNotification(mockUser, { userId: 'user-uuid-2' });
    expect(result).toBe(false);
  });

  it('匿名/未登录用户无法订阅私有通知频道', async () => {
    const result = await service.authorizeUserNotification(null as unknown as CurrentUserPayload, {
      userId: 'user-uuid-1',
    });
    expect(result).toBe(false);
  });

  it('登录用户可以订阅指定设备的 SSE 遥测推流频道', () => {
    const result = service.authorizeDeviceTelemetry(mockUser, { deviceId: 'plc-1' });
    expect(result).toBe(true);
  });

  it('缺少 deviceId 或未登录用户无法订阅 SSE 设备遥测频道', () => {
    expect(service.authorizeDeviceTelemetry(mockUser, {} as Record<string, string>)).toBe(false);
    expect(service.authorizeDeviceTelemetry(null as unknown as CurrentUserPayload, { deviceId: 'plc-1' })).toBe(false);
  });

  it('登录用户可以订阅全局 IoT 告警 SSE 广播频道', () => {
    expect(service.authorizeIotAlarms(mockUser)).toBe(true);
    expect(service.authorizeIotAlarms(null as unknown as CurrentUserPayload)).toBe(false);
  });
});

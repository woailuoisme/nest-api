import type { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MqttHealthIndicator } from '@/features/system/health/indicators/mqtt-health.indicator';
import type { MqttService } from '@/iot';

describe('MqttHealthIndicator (MQTT Broker 健康检查指示器)', () => {
  let indicator: MqttHealthIndicator;
  let mockMqttService: {
    getClient: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
    getReplyTopic: ReturnType<typeof vi.fn>;
    getReconnectAttempts: ReturnType<typeof vi.fn>;
  };
  let mockHealthIndicatorService: {
    check: ReturnType<typeof vi.fn>;
  };
  let mockIndicatorBuilder: {
    up: ReturnType<typeof vi.fn>;
    down: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockIndicatorBuilder = {
      up: vi.fn().mockImplementation((data) => ({ mqtt: { status: 'up', ...data } })),
      down: vi.fn().mockImplementation((data) => ({ mqtt: { status: 'down', ...data } })),
    };

    mockHealthIndicatorService = {
      check: vi.fn().mockReturnValue(mockIndicatorBuilder),
    };

    mockMqttService = {
      getClient: vi.fn(),
      isConnected: vi.fn(),
      getReplyTopic: vi.fn().mockReturnValue('app/rpc/test-pod/reply'),
      getReconnectAttempts: vi.fn().mockReturnValue(0),
    };

    indicator = new MqttHealthIndicator(
      mockMqttService as unknown as MqttService,
      mockHealthIndicatorService as unknown as HealthIndicatorService,
    );
  });

  it('当未配置 MQTT_URL 时应报告 inactive 状态，避免阻塞服务就绪检查', async () => {
    mockMqttService.getClient.mockReturnValue(null);

    const result = await indicator.isHealthy('mqtt');

    expect(mockHealthIndicatorService.check).toHaveBeenCalledWith('mqtt');
    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      connection: 'inactive',
      message: 'MQTT is not configured',
    });
    expect(result.mqtt.status).toBe('up');
  });

  it('当 MQTT 客户端在线连接时应报告 connected 状态与 Pod 专属 replyTopic', async () => {
    mockMqttService.getClient.mockReturnValue({});
    mockMqttService.isConnected.mockReturnValue(true);

    const result = await indicator.isHealthy('mqtt');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      connection: 'connected',
      replyTopic: 'app/rpc/test-pod/reply',
      reconnectAttempts: 0,
    });
    expect(result.mqtt.status).toBe('up');
  });

  it('当 MQTT 客户端断开连接或处于重连中时，应软降级报告 degraded 状态', async () => {
    mockMqttService.getClient.mockReturnValue({});
    mockMqttService.isConnected.mockReturnValue(false);
    mockMqttService.getReconnectAttempts.mockReturnValue(3);

    const result = await indicator.isHealthy('mqtt');

    expect(mockIndicatorBuilder.up).toHaveBeenCalledWith({
      state: 'degraded',
      connection: 'disconnected',
      reconnectAttempts: 3,
      message: 'MQTT client is disconnected or reconnecting',
    });
    expect(result.mqtt.status).toBe('up');
  });
});

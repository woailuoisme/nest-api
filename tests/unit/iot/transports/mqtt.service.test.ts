import { EventEmitter } from 'node:events';

import type { IPublishPacket, MqttClient } from 'mqtt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MqttOptions, MqttService } from '@/iot';

interface MockMqttClient {
  connected: boolean;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

/** 创建测试用 MQTT 模拟客户端 */
function createMockMqttClient(): MqttClient & MockMqttClient {
  const emitter = new EventEmitter();
  const mockMethods: MockMqttClient = {
    connected: true,
    publish: vi.fn((_topic: string, _message: unknown, _opts: unknown, cb?: (err?: Error | null) => void) =>
      cb?.(null),
    ),
    subscribe: vi.fn((_topic: unknown, _opts: unknown, cb?: (err?: Error | null) => void) => cb?.(null)),
    unsubscribe: vi.fn((_topic: unknown, _opts: unknown, cb?: (err?: Error | null) => void) => cb?.(null)),
    end: vi.fn((_force?: unknown, _opts?: unknown, cb?: () => void) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback?.();
    }),
  };

  return Object.assign(emitter, mockMethods) as unknown as MqttClient & MockMqttClient;
}

describe('MQTT 服务核心功能 (MqttService)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('优雅降级 (未配置 MQTT 连接时的行为)', () => {
    it('在客户端为 null 时应保持正常实例化且 isConnected 返回 false', () => {
      const service = new MqttService(null, null);

      expect(service.isConnected()).toBe(false);
      expect(service.getClient()).toBeNull();
    });

    it('在未配置连接时调用 publish 与 subscribe 应静默安全放行', async () => {
      const service = new MqttService(null, null);

      await expect(service.publish('test/topic', { foo: 'bar' })).resolves.toBeUndefined();
      await expect(service.subscribe('test/topic')).resolves.toBeUndefined();
      await expect(service.unsubscribe('test/topic')).resolves.toBeUndefined();
    });

    it('在未配置连接时调用 request RPC 应立即拒绝并抛出异常', async () => {
      const service = new MqttService(null, null);

      await expect(service.request('devices/plc-1/command', { action: 'start' })).rejects.toThrow('MQTT 客户端未激活');
    });
  });

  describe('标准消息发布与订阅 (Publish & Subscribe)', () => {
    it('应将对象负载序列化为 JSON 字符串并下发到 Broker', async () => {
      const mockClient = createMockMqttClient();
      const options: MqttOptions = { host: 'localhost', port: 1883, protocol: 'mqtt' };
      const service = new MqttService(mockClient, options);

      await service.publish('factory/line1/temp', { value: 25.4, unit: 'C' }, { qos: 1 });

      expect(mockClient.publish).toHaveBeenCalledWith(
        'factory/line1/temp',
        JSON.stringify({ value: 25.4, unit: 'C' }),
        expect.objectContaining({ qos: 1 }),
        expect.any(Function),
      );
    });

    it('应正确组装 MQTT 5.0 协议属性 (userProperties, responseTopic, correlationData)', async () => {
      const mockClient = createMockMqttClient();
      const service = new MqttService(mockClient, { host: 'localhost', port: 1883, protocol: 'mqtt' });

      await service.publish(
        'devices/dev-1/cmd',
        { op: 'reboot' },
        {
          qos: 1,
          responseTopic: 'app/reply',
          correlationData: 'corr-12345',
          userProperties: { traceId: 'trace-abc' },
        },
      );

      expect(mockClient.publish).toHaveBeenCalledWith(
        'devices/dev-1/cmd',
        JSON.stringify({ op: 'reboot' }),
        expect.objectContaining({
          qos: 1,
          properties: expect.objectContaining({
            responseTopic: 'app/reply',
            correlationData: Buffer.from('corr-12345'),
            userProperties: { traceId: 'trace-abc' },
          }),
        }),
        expect.any(Function),
      );
    });

    it('应支持 sharedGroup 共享订阅', async () => {
      const mockClient = createMockMqttClient();
      const service = new MqttService(mockClient, { host: 'localhost', port: 1883, protocol: 'mqtt' });

      await service.subscribe('devices/:id/telemetry', { qos: 1, sharedGroup: 'workers' });

      expect(mockClient.subscribe).toHaveBeenCalledWith(
        '$share/workers/devices/+/telemetry',
        expect.objectContaining({ qos: 1 }),
        expect.any(Function),
      );
    });
  });

  describe('MQTT 5.0 原生同步 RPC (request)', () => {
    it('当收到携带相同 correlationData 的设备回执时，应成功兑现 RPC Promise', async () => {
      const mockClient = createMockMqttClient();
      const service = new MqttService(mockClient, { host: 'localhost', port: 1883, protocol: 'mqtt' });

      // 触发应用引导阶段，注册回复监听
      await service.onApplicationBootstrap();

      const requestPromise = service.request<{ ack: boolean }>('devices/plc-1/command', {
        action: 'setSpeed',
        rpm: 1200,
      });

      // 拦截 publish 产生的 correlationData
      const publishCall = mockClient.publish.mock.calls[0];
      const sentProperties = publishCall[2].properties;
      const correlationData = sentProperties.correlationData as Buffer;

      expect(publishCall[0]).toBe('devices/plc-1/command');
      expect(sentProperties.responseTopic).toMatch(/^app\/rpc\/.+\/reply$/);
      expect(correlationData).toBeDefined();

      // 模拟设备向专属 reply 主题回送响应
      const mockReplyPayload = Buffer.from(JSON.stringify({ ack: true, speedSet: 1200 }));
      const mockPacket = {
        cmd: 'publish',
        topic: sentProperties.responseTopic,
        payload: mockReplyPayload,
        qos: 0,
        dup: false,
        retain: false,
        properties: {
          correlationData,
        },
      } as unknown as IPublishPacket;

      // 触发 message 事件
      mockClient.emit('message', sentProperties.responseTopic, mockReplyPayload, mockPacket);

      const result = await requestPromise;
      expect(result).toEqual({ ack: true, speedSet: 1200 });
    });

    it('当在指定超时时间内未收到设备回执时，应自动超时并拒绝 Promise', async () => {
      const mockClient = createMockMqttClient();
      const service = new MqttService(mockClient, { host: 'localhost', port: 1883, protocol: 'mqtt' });

      await service.onApplicationBootstrap();

      const requestPromise = service.request('devices/plc-1/command', { ping: true }, { timeoutMs: 1000 });

      // 触发定时器超时
      vi.advanceTimersByTime(1001);

      await expect(requestPromise).rejects.toThrow('等待设备控制应答超时 (1000ms)');
    });
  });

  describe('生命周期管理 (onApplicationShutdown)', () => {
    it('应用退出时应优雅关闭 MQTT 客户端', async () => {
      const mockClient = createMockMqttClient();
      const service = new MqttService(mockClient, { host: 'localhost', port: 1883, protocol: 'mqtt' });

      await service.onApplicationShutdown();

      expect(mockClient.end).toHaveBeenCalled();
    });
  });
});

import { NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { IPublishPacket } from 'mqtt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IOT_EVENTS } from '@/common/events';
import type { EnvConfig } from '@/config/env.validation';
import {
  type DeviceTelemetryDto,
  IotCommandService,
  IotController,
  IotDeviceCredentialService,
  IotTelemetryService,
  MAX_COMMAND_HISTORY,
  type MqttMessageContext,
  type MqttService,
} from '@/iot';

/** 测试用设备凭证表（与下方换票用例中的 deviceId/deviceSecret 严格对应） */
const DEVICE_CREDENTIALS = 'cnc-001:secret123456,plc-token-test:secret-key-12345';
/** 测试用设备租户注册表（设备 token 的租户只能来源于此） */
const DEVICE_TENANTS = 'cnc-001:factory-a,plc-token-test:tenant-test';
const DEVICE_PEPPER = 'test-iot-device-pepper-16chars';
const IOT_JWT_SECRET = 'test-iot-jwt-secret-32-characters-minimum';
const TOKEN_TTL_SECONDS = 3600;

/** 构造设备凭证服务，可覆盖任意 env 以验证 fail fast 分支 */
function createCredentialService(overrides: Record<string, unknown> = {}): IotDeviceCredentialService {
  const values: Record<string, unknown> = {
    IOT_DEVICE_CREDENTIALS: DEVICE_CREDENTIALS,
    IOT_DEVICE_TENANTS: DEVICE_TENANTS,
    IOT_DEVICE_PEPPER: DEVICE_PEPPER,
    IOT_JWT_SECRET,
    IOT_TOKEN_TTL_SECONDS: TOKEN_TTL_SECONDS,
    ...overrides,
  };
  const configService = { get: (key: string) => values[key] } as unknown as ConfigService<EnvConfig, true>;
  return new IotDeviceCredentialService(configService);
}

describe('工业物联网特性服务与控制器 (IoT Feature)', () => {
  let telemetryService: IotTelemetryService;
  let commandService: IotCommandService;
  let controller: IotController;
  let mockMqttService: {
    isConnected: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    getBrokerUrl: ReturnType<typeof vi.fn>;
  };
  let mockEventEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockMqttService = {
      isConnected: vi.fn().mockReturnValue(true),
      request: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
      getBrokerUrl: vi.fn().mockReturnValue('mqtt://localhost:1883'),
    };

    mockEventEmitter = {
      emit: vi.fn(),
    };

    telemetryService = new IotTelemetryService(
      mockEventEmitter as unknown as EventEmitter2,
      mockMqttService as unknown as MqttService,
      createCredentialService(),
    );
    commandService = new IotCommandService(
      mockMqttService as unknown as MqttService,
      mockEventEmitter as unknown as EventEmitter2,
      createCredentialService(),
    );
    controller = new IotController(telemetryService, commandService);
  });

  describe('IotTelemetryService (遥测采集与设备影子)', () => {
    const sampleTelemetry: DeviceTelemetryDto = {
      voltage: 220.5,
      current: 4.8,
      temperature: 65.2,
      vibration: 1.1,
      status: 'running',
    };

    it('应在接收到遥测时自动记录并生成设备影子快照，同时派发 TELEMETRY_RECEIVED 领域事件', () => {
      const mockContext: MqttMessageContext = {
        topic: 'devices/tenant-1/plc-1/telemetry',
        params: { tenantId: 'tenant-1', deviceId: 'plc-1' },
        packet: {} as unknown as IPublishPacket,
        qos: 1,
      };

      telemetryService.handleTelemetry(sampleTelemetry, 'tenant-1', 'plc-1', mockContext);

      const shadow = telemetryService.getDeviceShadow('tenant-1', 'plc-1');
      expect(shadow).toBeDefined();
      expect(shadow?.deviceId).toBe('plc-1');
      expect(shadow?.tenantId).toBe('tenant-1');
      expect(shadow?.online).toBe(true);
      expect(shadow?.telemetry).toEqual(sampleTelemetry);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        IOT_EVENTS.TELEMETRY_RECEIVED,
        expect.objectContaining({
          tenantId: 'tenant-1',
          deviceId: 'plc-1',
          telemetry: sampleTelemetry,
        }),
      );
    });

    it('当设备温度超限 (>85℃) 时应派发 ALARM_TRIGGERED 告警领域事件', () => {
      const highTempTelemetry: DeviceTelemetryDto = {
        ...sampleTelemetry,
        temperature: 92.5,
      };
      const mockContext: MqttMessageContext = {
        topic: 'devices/tenant-1/plc-1/telemetry',
        params: { tenantId: 'tenant-1', deviceId: 'plc-1' },
        packet: {} as unknown as IPublishPacket,
        qos: 1,
      };

      telemetryService.handleTelemetry(highTempTelemetry, 'tenant-1', 'plc-1', mockContext);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        IOT_EVENTS.ALARM_TRIGGERED,
        expect.objectContaining({
          tenantId: 'tenant-1',
          deviceId: 'plc-1',
          level: 'critical',
          metric: 'temperature',
          value: 92.5,
          threshold: 85,
        }),
      );
    });

    it('当收到设备 LWT 离线遗嘱消息时应更新设备影子在线状态为 false，并派发 STATUS_CHANGED 事件', () => {
      telemetryService.recordTelemetry('tenant-1', 'plc-1', sampleTelemetry);

      telemetryService.handleDeviceStatus({ status: 'offline', reason: 'Connection Lost (LWT)' }, 'tenant-1', 'plc-1');

      const shadow = telemetryService.getDeviceShadow('tenant-1', 'plc-1');
      expect(shadow?.online).toBe(false);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        IOT_EVENTS.STATUS_CHANGED,
        expect.objectContaining({
          tenantId: 'tenant-1',
          deviceId: 'plc-1',
          status: 'offline',
          reason: 'Connection Lost (LWT)',
        }),
      );
    });

    it('查询不存在的设备影子应返回 null', () => {
      expect(telemetryService.getDeviceShadow('tenant-1', 'non-existent')).toBeNull();
    });

    it('getDeviceShadowOrFail 查询不存在设备应抛出 NotFoundException，存在时应返回影子', () => {
      expect(() => telemetryService.getDeviceShadowOrFail('tenant-1', 'non-existent')).toThrow(NotFoundException);
      telemetryService.recordTelemetry('tenant-1', 'plc-1', sampleTelemetry);
      expect(telemetryService.getDeviceShadowOrFail('tenant-1', 'plc-1').deviceId).toBe('plc-1');
    });

    it('同名设备在不同租户下不得互相覆盖', () => {
      telemetryService.recordTelemetry('tenant-a', 'plc-1', sampleTelemetry);
      telemetryService.recordTelemetry('tenant-b', 'plc-1', { ...sampleTelemetry, temperature: 99 });

      expect(telemetryService.getDeviceShadow('tenant-a', 'plc-1')?.telemetry?.temperature).toBe(65.2);
      expect(telemetryService.getDeviceShadow('tenant-b', 'plc-1')?.telemetry?.temperature).toBe(99);
      expect(telemetryService.listDeviceShadows('tenant-a')).toHaveLength(1);
    });

    it('listDeviceShadows 应返回所有活跃设备影子列表', () => {
      telemetryService.recordTelemetry('tenant-1', 'plc-1', sampleTelemetry);
      telemetryService.recordTelemetry('tenant-1', 'plc-2', sampleTelemetry);

      const list = telemetryService.listDeviceShadows();
      expect(list).toHaveLength(2);
      expect(list.map((d) => d.deviceId)).toEqual(['plc-1', 'plc-2']);
    });

    it('simulateTelemetry 在 MQTT 就绪时应发布消息并更新影子', async () => {
      const shadow = await telemetryService.simulateTelemetry('tenant-1', 'plc-3', sampleTelemetry);
      expect(mockMqttService.publish).toHaveBeenCalledWith('devices/tenant-1/plc-3/telemetry', sampleTelemetry, {
        qos: 1,
      });
      expect(shadow.deviceId).toBe('plc-3');
      expect(shadow.online).toBe(true);
    });

    it('simulateTelemetry 在 MQTT 未连接时只更新影子而不发布消息', async () => {
      mockMqttService.isConnected.mockReturnValue(false);
      const shadow = await telemetryService.simulateTelemetry('tenant-1', 'plc-4', sampleTelemetry);
      expect(mockMqttService.publish).not.toHaveBeenCalled();
      expect(shadow.deviceId).toBe('plc-4');
      expect(shadow.online).toBe(true);
    });

    it('issueDeviceToken 应校验设备密钥后签发包含 jti 等标准 Claims 的 JWT 凭证', () => {
      const res = telemetryService.issueDeviceToken({
        deviceId: 'cnc-001',
        deviceSecret: 'secret123456',
      });

      expect(res.token.split('.')).toHaveLength(3); // 标准 JWT 三段式
      expect(res.expiresIn).toBe(TOKEN_TTL_SECONDS);
      expect(res.brokerUrl).toBe('mqtt://localhost:1883');

      const claims = JSON.parse(Buffer.from(res.token.split('.')[1], 'base64url').toString('utf8'));
      expect(claims).toMatchObject({ sub: 'cnc-001', tenantId: 'factory-a', role: 'device' });
      expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
      expect(claims.exp - claims.iat).toBe(TOKEN_TTL_SECONDS);
    });

    it('设备密钥错误或设备未注册时应抛出同一语义的 UnauthorizedException（不泄露注册状态）', () => {
      const capture = (deviceId: string, deviceSecret: string): Error => {
        try {
          telemetryService.issueDeviceToken({ deviceId, deviceSecret });
        } catch (error) {
          return error as Error;
        }
        throw new Error('预期应抛出 UnauthorizedException');
      };

      const wrongSecretError = capture('cnc-001', 'wrong-secret');
      const unknownDeviceError = capture('unknown-device', 'secret123456');

      expect(wrongSecretError).toBeInstanceOf(UnauthorizedException);
      expect(unknownDeviceError).toBeInstanceOf(UnauthorizedException);
      expect(wrongSecretError.message).toBe(unknownDeviceError.message);
    });

    it('未配置 IOT_JWT_SECRET 时应拒绝签发设备凭据（fail fast，不回退硬编码密钥）', () => {
      const staleService = new IotTelemetryService(
        mockEventEmitter as unknown as EventEmitter2,
        mockMqttService as unknown as MqttService,
        createCredentialService({ IOT_JWT_SECRET: undefined }),
      );

      expect(() => staleService.issueDeviceToken({ deviceId: 'cnc-001', deviceSecret: 'secret123456' })).toThrow(
        ServiceUnavailableException,
      );
    });

    it('未配置任何设备凭证时应拒绝所有换票请求', () => {
      const noCredentialService = new IotTelemetryService(
        mockEventEmitter as unknown as EventEmitter2,
        mockMqttService as unknown as MqttService,
        createCredentialService({ IOT_DEVICE_CREDENTIALS: '' }),
      );

      expect(() => noCredentialService.issueDeviceToken({ deviceId: 'cnc-001', deviceSecret: 'secret123456' })).toThrow(
        UnauthorizedException,
      );
    });

    it('handleDeviceEvent 应正确处理突发硬件告警并派发 ALARM_TRIGGERED 领域事件', () => {
      telemetryService.handleDeviceEvent(
        {
          tenantId: 'factory-a',
          deviceId: 'cnc-001',
          level: 'critical',
          metric: 'e_stop',
          value: 1,
          threshold: 0,
          message: '急停按钮被按下',
        },
        'factory-a',
        'cnc-001',
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        IOT_EVENTS.ALARM_TRIGGERED,
        expect.objectContaining({
          tenantId: 'factory-a',
          deviceId: 'cnc-001',
          level: 'critical',
          metric: 'e_stop',
          message: '急停按钮被按下',
        }),
      );
    });

    it('simulateEvent 应向 Broker 发送告警并触发领域事件', async () => {
      await telemetryService.simulateEvent({
        tenantId: 'factory-a',
        deviceId: 'cnc-002',
        level: 'warning',
        metric: 'vibration_limit',
        value: 4.5,
        threshold: 3.0,
        message: '主轴轴承振动超标',
      });

      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/factory-a/cnc-002/events',
        expect.objectContaining({
          metric: 'vibration_limit',
        }),
        { qos: 1 },
      );
    });
  });

  describe('IotCommandService (指令下发与设备模拟)', () => {
    it('当 MQTT 代理断开时下发指令应抛出 ServiceUnavailableException', async () => {
      mockMqttService.isConnected.mockReturnValue(false);

      await expect(commandService.sendCommand('plc-1', 'startMotor')).rejects.toThrow(ServiceUnavailableException);
    });

    it('应通过 MqttService.request 执行同步 RPC 并返回执行回执，同时派发 COMMAND_EXECUTED 领域事件', async () => {
      mockMqttService.request.mockResolvedValue({ ack: true, motorSpeed: 1500 });

      const result = await commandService.sendCommand('plc-1', 'setSpeed', { rpm: 1500 });

      expect(mockMqttService.request).toHaveBeenCalledWith(
        // 未在 IOT_DEVICE_TENANTS 登记的设备归入 default 租户
        'devices/default/plc-1/command',
        expect.objectContaining({
          command: 'setSpeed',
          params: { rpm: 1500 },
        }),
        expect.objectContaining({
          timeoutMs: 5000,
          qos: 1,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.deviceId).toBe('plc-1');
      expect(result.command).toBe('setSpeed');
      expect(result.data).toEqual({ ack: true, motorSpeed: 1500 });
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        IOT_EVENTS.COMMAND_EXECUTED,
        expect.objectContaining({
          deviceId: 'plc-1',
          command: 'setSpeed',
          success: true,
          data: { ack: true, motorSpeed: 1500 },
        }),
      );
    });

    it('sendCommand 应维护指令状态机并在成功时记录 SUCCESS 审计历史', async () => {
      mockMqttService.request.mockResolvedValue({ ack: true });

      await commandService.sendCommand('plc-audit-1', 'powerOn', { mode: 'auto' });

      const history = commandService.getCommandHistory('plc-audit-1');
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('SUCCESS');
      expect(history[0].deviceId).toBe('plc-audit-1');
      expect(history[0].command).toBe('powerOn');
      expect(history[0].data).toEqual({ ack: true });
    });

    it('指令审计历史应按「最新在前」返回', async () => {
      mockMqttService.request.mockResolvedValue({ ack: true });

      await commandService.sendCommand('plc-order-1', 'first');
      await commandService.sendCommand('plc-order-1', 'second');

      const history = commandService.getCommandHistory('plc-order-1');
      expect(history.map((record) => record.command)).toEqual(['second', 'first']);
    });

    it('审计历史超过容量上限时应淘汰最旧记录并保持恒定容量', async () => {
      mockMqttService.request.mockResolvedValue({ ack: true });

      const total = MAX_COMMAND_HISTORY + 1;
      for (let index = 0; index < total; index++) {
        await commandService.sendCommand('plc-cap-1', `cmd-${index}`);
      }

      const history = commandService.getCommandHistory();
      expect(history).toHaveLength(MAX_COMMAND_HISTORY);
      expect(history[0].command).toBe(`cmd-${total - 1}`);
      expect(history.at(-1)?.command).toBe('cmd-1'); // 最旧的 cmd-0 已被淘汰
    });

    it('模拟设备响应器收到指令时应原路回送带有相同 correlationData 的确认消息', async () => {
      const mockContext: MqttMessageContext = {
        topic: 'devices/plc-sim-1/command',
        params: { deviceId: 'plc-sim-1' },
        packet: {} as unknown as IPublishPacket,
        qos: 1,
        responseTopic: 'app/rpc/pod-99/reply',
        correlationData: Buffer.from('req-uuid-001'),
      };

      await commandService.handleMockDeviceCommand(
        { command: 'calibrate', params: { axis: 'Z' }, timestamp: Date.now() },
        'plc-sim-1',
        mockContext,
      );

      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'app/rpc/pod-99/reply',
        expect.objectContaining({
          ack: true,
          deviceId: 'plc-sim-1',
          executedCommand: 'calibrate',
        }),
        expect.objectContaining({
          qos: 1,
          correlationData: Buffer.from('req-uuid-001'),
        }),
      );
    });
  });

  describe('IotController (REST 控制器)', () => {
    it('getShadow 查询不存在的设备时应抛出 NotFoundException', () => {
      expect(() => controller.getShadow('missing-dev', {})).toThrow(NotFoundException);
    });

    it('mockTelemetry 在 MQTT 连接时应向 Broker 发送遥测并更新影子', async () => {
      const sampleDto = {
        tenantId: 'tenant-test',
        deviceId: 'plc-88',
        telemetry: {
          voltage: 380,
          current: 12.5,
          temperature: 45.0,
          vibration: 0.8,
          status: 'running' as const,
        },
      };

      const shadow = await controller.mockTelemetry(sampleDto);

      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/tenant-test/plc-88/telemetry',
        sampleDto.telemetry,
        { qos: 1 },
      );
      expect(shadow.deviceId).toBe('plc-88');
      expect(shadow.online).toBe(true);
    });

    it('issueDeviceToken 应调用 telemetryService 成功签发凭证', () => {
      const res = controller.issueDeviceToken({
        deviceId: 'plc-token-test',
        deviceSecret: 'secret-key-12345',
      });

      expect(res.token).toBeDefined();
      expect(res.brokerUrl).toBe('mqtt://localhost:1883');
      expect(res.expiresIn).toBe(TOKEN_TTL_SECONDS);
    });

    it('mockEvent 应向 Broker 发送硬件告警并返回成功', async () => {
      const res = await controller.mockEvent({
        tenantId: 'tenant-test',
        deviceId: 'plc-alarm-test',
        level: 'critical',
        metric: 'e_stop',
        value: 1,
        threshold: 0,
        message: '急停按钮触发',
      });

      expect(res.success).toBe(true);
      expect(mockMqttService.publish).toHaveBeenCalledWith(
        'devices/tenant-test/plc-alarm-test/events',
        expect.objectContaining({ metric: 'e_stop' }),
        { qos: 1 },
      );
    });
  });
});

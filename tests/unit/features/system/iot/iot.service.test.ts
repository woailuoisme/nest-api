import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { IPublishPacket } from 'mqtt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IOT_EVENTS } from '@/common/events';
import type { MqttMessageContext, MqttService } from '@/common/mqtt';
import type { DeviceTelemetryDto } from '@/features/system/iot/dto/iot.dto';
import { IotController } from '@/features/system/iot/iot.controller';
import { IotCommandService } from '@/features/system/iot/iot-command.service';
import { IotTelemetryService } from '@/features/system/iot/iot-telemetry.service';

describe('工业物联网特性服务与控制器 (IoT Feature)', () => {
  let telemetryService: IotTelemetryService;
  let commandService: IotCommandService;
  let controller: IotController;
  let mockMqttService: {
    isConnected: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
  let mockEventEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockMqttService = {
      isConnected: vi.fn().mockReturnValue(true),
      request: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockEventEmitter = {
      emit: vi.fn(),
    };

    telemetryService = new IotTelemetryService(
      mockEventEmitter as unknown as EventEmitter2,
      mockMqttService as unknown as MqttService,
    );
    commandService = new IotCommandService(
      mockMqttService as unknown as MqttService,
      mockEventEmitter as unknown as EventEmitter2,
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

      const shadow = telemetryService.getDeviceShadow('plc-1');
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

      const shadow = telemetryService.getDeviceShadow('plc-1');
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
      expect(telemetryService.getDeviceShadow('non-existent')).toBeNull();
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
        'devices/plc-1/command',
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
      expect(() => controller.getShadow('missing-dev')).toThrow(NotFoundException);
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
  });
});

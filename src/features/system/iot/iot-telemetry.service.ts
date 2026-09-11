import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IOT_EVENTS,
  type IotAlarmTriggeredEvent,
  type IotDeviceStatusChangedEvent,
  type IotTelemetryReceivedEvent,
} from '@/common/events';
import { MqttCtx, type MqttMessageContext, MqttParams, MqttPayload, MqttService, MqttSubscribe } from '@/common/mqtt';
import type { DeviceShadowEntity, DeviceTelemetryDto } from './dto/iot.dto';

export interface DeviceStatusPayload {
  status: 'online' | 'offline';
  reason?: string;
  timestamp?: number;
}

/**
 * 工业设备遥测与状态影子管理服务
 *
 * 核心职责：
 * 1. 利用 MQTT 5.0 共享订阅 `$share/telemetry-workers/...` 实现 Pod 集群间遥测流量无锁负载均衡。
 * 2. 模式匹配动态提取 `:tenantId` 与 `:deviceId`，维护工业设备实时数字影子 (Device Shadow)。
 * 3. 监听设备遗嘱消息 (LWT)，实现设备非正常断网的毫秒级离线感知。
 * 4. 接入领域事件机制 (@nestjs/event-emitter)，驱动实时流（WebSocket/SSE）与跨领域协同。
 */
@Injectable()
export class IotTelemetryService {
  private readonly logger = new Logger(IotTelemetryService.name);

  /** 设备影子状态内存缓存 (生产可接入 Redis 或时序数据库 TimescaleDB/ClickHouse) */
  private readonly deviceShadows = new Map<string, DeviceShadowEntity>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly mqttService: MqttService,
  ) {}

  /**
   * 监听工业设备遥测上报 (共享订阅：telemetry-workers)
   */
  @MqttSubscribe('devices/:tenantId/:deviceId/telemetry', {
    qos: 1,
    sharedGroup: 'telemetry-workers',
  })
  handleTelemetry(
    @MqttPayload() telemetry: DeviceTelemetryDto,
    @MqttParams('tenantId') tenantId: string,
    @MqttParams('deviceId') deviceId: string,
    @MqttCtx() context: MqttMessageContext,
  ): void {
    this.logger.debug(
      `[Telemetry Received] Device: ${deviceId} (${tenantId}) | Temp: ${telemetry.temperature}℃ | Status: ${telemetry.status} | QoS: ${context.qos}`,
    );

    const now = Date.now();

    // 工业阈值超限告警判定并派发领域事件
    if (telemetry.temperature > 85) {
      this.logger.warn(
        `[Industrial Alarm] Device ${deviceId} temperature critical: ${telemetry.temperature}℃! High vibration risk.`,
      );

      const alarmEvent: IotAlarmTriggeredEvent = {
        tenantId,
        deviceId,
        level: 'critical',
        metric: 'temperature',
        value: telemetry.temperature,
        threshold: 85,
        message: `Device ${deviceId} temperature critical: ${telemetry.temperature}℃`,
        timestamp: now,
      };
      this.eventEmitter.emit(IOT_EVENTS.ALARM_TRIGGERED, alarmEvent);
    }

    // 派发遥测接收领域事件
    const telemetryEvent: IotTelemetryReceivedEvent = {
      tenantId,
      deviceId,
      telemetry,
      timestamp: now,
    };
    this.eventEmitter.emit(IOT_EVENTS.TELEMETRY_RECEIVED, telemetryEvent);

    this.recordTelemetry(tenantId, deviceId, telemetry);
  }

  /**
   * 监听工业设备在线/遗嘱状态 (LWT 实时捕获)
   */
  @MqttSubscribe('devices/:tenantId/:deviceId/status', { qos: 1 })
  handleDeviceStatus(
    @MqttPayload() payload: DeviceStatusPayload,
    @MqttParams('tenantId') tenantId: string,
    @MqttParams('deviceId') deviceId: string,
  ): void {
    const isOnline = payload.status === 'online';
    this.logger.log(
      `[Device Status Change] Device: ${deviceId} is now ${payload.status} (Reason: ${payload.reason ?? 'N/A'})`,
    );

    // 派发设备状态变更领域事件
    const statusEvent: IotDeviceStatusChangedEvent = {
      tenantId,
      deviceId,
      status: payload.status,
      reason: payload.reason,
      timestamp: payload.timestamp ?? Date.now(),
    };
    this.eventEmitter.emit(IOT_EVENTS.STATUS_CHANGED, statusEvent);

    const existing = this.deviceShadows.get(deviceId);
    if (existing) {
      existing.online = isOnline;
      existing.lastSeenAt = new Date().toISOString();
    } else {
      this.deviceShadows.set(deviceId, {
        deviceId,
        tenantId,
        online: isOnline,
        lastSeenAt: new Date().toISOString(),
        telemetry: null,
      });
    }
  }

  /**
   * 记录并更新设备影子快照
   */
  recordTelemetry(tenantId: string, deviceId: string, telemetry: DeviceTelemetryDto): DeviceShadowEntity {
    const shadow: DeviceShadowEntity = {
      deviceId,
      tenantId,
      online: true,
      lastSeenAt: new Date().toISOString(),
      telemetry,
    };
    this.deviceShadows.set(deviceId, shadow);
    return shadow;
  }

  /**
   * 模拟设备遥测上报：若 MQTT 连接就绪则发布消息至 Broker，并更新设备影子
   */
  async simulateTelemetry(
    tenantId: string,
    deviceId: string,
    telemetry: DeviceTelemetryDto,
  ): Promise<DeviceShadowEntity> {
    if (this.mqttService.isConnected()) {
      await this.mqttService.publish(`devices/${tenantId}/${deviceId}/telemetry`, telemetry, { qos: 1 });
    }
    return this.recordTelemetry(tenantId, deviceId, telemetry);
  }

  /**
   * 查询指定设备影子
   */
  getDeviceShadow(deviceId: string): DeviceShadowEntity | null {
    return this.deviceShadows.get(deviceId) ?? null;
  }

  /**
   * 获取所有设备影子列表
   */
  listDeviceShadows(): DeviceShadowEntity[] {
    return Array.from(this.deviceShadows.values());
  }
}

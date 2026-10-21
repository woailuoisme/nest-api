import { randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  IOT_EVENTS,
  type IotAlarmTriggeredEvent,
  type IotDeviceStatusChangedEvent,
  type IotTelemetryReceivedEvent,
} from '@/common/events';
import { signHs256Jwt } from '@/common/utils/jwt.util';

import { MqttCtx, MqttParams, MqttPayload, MqttSubscribe } from '../decorators';
import type {
  DeviceCriticalEventDto,
  DeviceShadowEntity,
  DeviceStatusPayload,
  DeviceTelemetryDto,
  DeviceTokenRequestDto,
  DeviceTokenResponseDto,
} from '../dto/iot.dto';
import type { MqttMessageContext } from '../transports/interfaces/mqtt.interface';
import { MqttService } from '../transports/mqtt.service';
import { IotDeviceCredentialService } from './iot-device-credential.service';

/** 设备影子内存缓存上限：超出后按插入顺序淘汰最早条目，防止无界增长 */
const MAX_DEVICE_SHADOWS = 10_000;

/** 影子缓存键：必须包含租户，避免同名设备跨租户互相覆盖 */
function shadowKey(tenantId: string, deviceId: string): string {
  return `${tenantId}:${deviceId}`;
}

/**
 * 工业设备遥测、状态与控制安全服务 (IotTelemetryService)
 *
 * 核心设计（数据面与控制面分离架构）：
 * 1. 数据面分流：在生产环境中，海量高频传感器遥测推荐由 Telegraf (mqtt_consumer) 旁路直写 TimescaleDB，
 *    彻底释放 NestJS 进程事件循环；
 * 2. 控制面聚焦：NestJS 核心掌控设备安全凭证签发 (JWT)、在线/遗嘱状态感知 (LWT)、突发硬件告警捕获与实时大屏联动；
 * 3. 仿真支持：保留本地开发测试用的遥测模拟器与内存数字影子 (Device Shadow)。
 */
@Injectable()
export class IotTelemetryService {
  private readonly logger = new Logger(IotTelemetryService.name);

  /**
   * 设备影子状态内存缓存 (热态最新在线状态与快照)
   *
   * 键必须包含租户：仅用 deviceId 会让不同租户的同名设备互相覆盖（租户 A 的状态出现在租户 B 的看板）。
   */
  private readonly deviceShadows = new Map<string, DeviceShadowEntity>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly mqttService: MqttService,
    private readonly deviceCredentials: IotDeviceCredentialService,
  ) {}

  /**
   * 签发设备接入 Mosquitto 所需的 JWT 凭据 (一机一密换票)
   *
   * 先恒定时间校验设备预置密钥（失败即 401，且不泄露设备注册状态），
   * 再使用与业务鉴权隔离的 IOT_JWT_SECRET 签名，凭证由 Mosquitto 端 mosquitto-go-auth 本地验签。
   */
  issueDeviceToken(dto: DeviceTokenRequestDto): DeviceTokenResponseDto {
    this.deviceCredentials.verifyCredential(dto.deviceId, dto.deviceSecret);

    const secret = this.deviceCredentials.requireJwtSecret();
    const expiresIn = this.deviceCredentials.getTokenTtlSeconds();
    const nowSec = Math.floor(Date.now() / 1000);

    const token = signHs256Jwt(
      {
        sub: dto.deviceId,
        // 租户取自服务端注册表：请求体可被伪造，同设备否则可向任意租户命名空间发布数据
        tenantId: this.deviceCredentials.resolveTenant(dto.deviceId),
        role: 'device',
        // jti 用于支持凭据吊销（黑名单 / 轮换后即时失效）
        jti: randomUUID(),
        iat: nowSec,
        exp: nowSec + expiresIn,
      },
      secret,
    );

    const brokerUrl = this.mqttService.getBrokerUrl();

    this.logger.log(`成功为工业设备 [${dto.deviceId}] 签发 Mosquitto JWT 凭据 (有效期: ${expiresIn}s)`);

    return {
      token,
      expiresIn,
      brokerUrl,
    };
  }

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

    const key = shadowKey(tenantId, deviceId);
    const existing = this.deviceShadows.get(key);
    this.setShadow(key, {
      deviceId,
      tenantId,
      online: isOnline,
      lastSeenAt: new Date().toISOString(),
      telemetry: existing?.telemetry ?? null,
    });
  }

  /**
   * 监听工业设备突发关键事件与硬件告警 (QoS 1 保证触达)
   */
  @MqttSubscribe('devices/:tenantId/:deviceId/events', { qos: 1 })
  handleDeviceEvent(
    @MqttPayload() payload: DeviceCriticalEventDto,
    @MqttParams('tenantId') tenantId: string,
    @MqttParams('deviceId') deviceId: string,
  ): void {
    this.logger.warn(
      `[Device Critical Event] 设备 [${deviceId}] 发生突发告警: [${payload.metric}] ${payload.message} (等级: ${payload.level ?? 'warning'})`,
    );

    const alarmEvent: IotAlarmTriggeredEvent = {
      // 租户与设备一律取自 topic（已由 broker ACL 限定的发布路径），
      // 不采信载荷自报值：设备可伪造成其他租户/其他设备告警
      tenantId,
      deviceId,
      level: payload.level || 'warning',
      metric: payload.metric,
      value: payload.value,
      threshold: payload.threshold,
      message: payload.message,
      timestamp: payload.timestamp ?? Date.now(),
    };

    this.eventEmitter.emit(IOT_EVENTS.ALARM_TRIGGERED, alarmEvent);
  }

  /**
   * 模拟设备突发告警上报 (测试与仿真联调)
   */
  async simulateEvent(dto: DeviceCriticalEventDto): Promise<void> {
    const tenantId = dto.tenantId || 'default';
    const deviceId = dto.deviceId;
    await this.publishIfConnected(`devices/${tenantId}/${deviceId}/events`, dto);
    this.handleDeviceEvent(dto, tenantId, deviceId);
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
    this.setShadow(shadowKey(tenantId, deviceId), shadow);
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
    await this.publishIfConnected(`devices/${tenantId}/${deviceId}/telemetry`, telemetry);
    return this.recordTelemetry(tenantId, deviceId, telemetry);
  }

  /**
   * 内部方法：Broker 就绪时以 QoS 1 上报消息，未连接时静默降级为仅本地更新
   */
  private async publishIfConnected(topic: string, payload: object): Promise<void> {
    if (!this.mqttService.isConnected()) {
      return;
    }
    await this.mqttService.publish(topic, payload, { qos: 1 });
  }

  /**
   * 查询指定设备影子
   */
  getDeviceShadow(tenantId: string, deviceId: string): DeviceShadowEntity | null {
    return this.deviceShadows.get(shadowKey(tenantId, deviceId)) ?? null;
  }

  /**
   * 查询指定设备影子，若不存在则抛出 NotFoundException
   */
  getDeviceShadowOrFail(tenantId: string, deviceId: string): DeviceShadowEntity {
    const shadow = this.getDeviceShadow(tenantId, deviceId);
    if (!shadow) {
      throw new NotFoundException(`设备 [${tenantId}/${deviceId}] 影子不存在或尚未上报遥测`);
    }
    return shadow;
  }

  /**
   * 获取设备影子列表（可按租户过滤）
   */
  listDeviceShadows(tenantId?: string): DeviceShadowEntity[] {
    const all = Array.from(this.deviceShadows.values());
    return tenantId ? all.filter((shadow) => shadow.tenantId === tenantId) : all;
  }

  /**
   * 写入影子并限制内存占用：设备规模超预期时按插入顺序淘汰最早条目，
   * 避免长期运行后 Map 无限增长成为堆泄漏源。
   */
  private setShadow(key: string, shadow: DeviceShadowEntity): void {
    this.deviceShadows.delete(key);
    this.deviceShadows.set(key, shadow);

    if (this.deviceShadows.size <= MAX_DEVICE_SHADOWS) return;

    const overflow = this.deviceShadows.size - MAX_DEVICE_SHADOWS;
    let removed = 0;
    for (const oldestKey of this.deviceShadows.keys()) {
      this.deviceShadows.delete(oldestKey);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
}

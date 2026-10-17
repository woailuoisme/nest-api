import { createHmac, randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  IOT_EVENTS,
  type IotAlarmTriggeredEvent,
  type IotDeviceStatusChangedEvent,
  type IotTelemetryReceivedEvent,
} from '@/common/events';

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

function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const hmac = createHmac('sha256', secret);
  hmac.update(signatureInput);
  const signatureB64 = toBase64Url(hmac.digest());

  return `${signatureInput}.${signatureB64}`;
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

  /** 设备影子状态内存缓存 (热态最新在线状态与快照) */
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
        tenantId: dto.tenantId || 'default',
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

    const existing = this.deviceShadows.get(deviceId);
    this.deviceShadows.set(deviceId, {
      deviceId,
      // 保留既有租户绑定与遥测快照，仅在首次建档时采用主题中的租户
      tenantId: existing?.tenantId ?? tenantId,
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
      tenantId: payload.tenantId || tenantId,
      deviceId: payload.deviceId || deviceId,
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
  getDeviceShadow(deviceId: string): DeviceShadowEntity | null {
    return this.deviceShadows.get(deviceId) ?? null;
  }

  /**
   * 查询指定设备影子，若不存在则抛出 NotFoundException
   */
  getDeviceShadowOrFail(deviceId: string): DeviceShadowEntity {
    const shadow = this.getDeviceShadow(deviceId);
    if (!shadow) {
      throw new NotFoundException(`设备 [${deviceId}] 影子不存在或尚未上报遥测`);
    }
    return shadow;
  }

  /**
   * 获取所有设备影子列表
   */
  listDeviceShadows(): DeviceShadowEntity[] {
    return Array.from(this.deviceShadows.values());
  }
}

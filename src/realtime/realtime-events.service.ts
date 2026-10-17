import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import {
  IOT_EVENTS,
  type IotAlarmTriggeredEvent,
  type IotCommandExecutedEvent,
  type IotDeviceStatusChangedEvent,
  type IotTelemetryReceivedEvent,
} from '@/common/events';
import type { NotificationBroadcastEvent, NotificationSentEvent } from '@/common/events/notification.event';

import { REALTIME_CHANNELS } from './channels/realtime-channels.service';
import type {
  CentrifugoProxyResponseDto,
  CentrifugoProxySubscribeDto,
  RealtimeSubscribeResponseDto,
  RealtimeTokenResponseDto,
} from './dto/realtime.dto';
import { RealtimeService } from './realtime.service';

/**
 * 统一实时业务与通信事件中枢服务 (RealtimeEventsService)
 * 1. 负责长连接 Token 签发与订阅鉴权（支持 Centrifugo Proxy Webhook 与 Token 双模）；
 * 2. 集中监听系统与业务领域事件，通过 Centrifugo 规范频道单一分发，彻底消除多倍推流与冗余克隆。
 */
@Injectable()
export class RealtimeEventsService {
  private readonly logger = new Logger(RealtimeEventsService.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * 为客户端签发连接 Token（支持指定协议返回对应的连接端点 URL）
   */
  createConnectionToken(
    user: CurrentUserPayload,
    protocol: 'websocket' | 'sse' = 'websocket',
  ): RealtimeTokenResponseDto {
    const result = this.realtimeService.createConnectionToken(user);
    const url = protocol === 'sse' ? this.realtimeService.getSseUrl() : this.realtimeService.getWsUrl();
    return {
      token: result.token,
      url,
      protocol,
    };
  }

  /**
   * 处理私有频道订阅鉴权 (客户端 Token 模式)
   */
  async subscribeChannel(
    user: CurrentUserPayload,
    channel: string,
    client?: string,
  ): Promise<RealtimeSubscribeResponseDto> {
    const subscribeDto = client !== undefined ? { channel, client } : { channel };
    return this.realtimeService.authorizeSubscription(user, subscribeDto);
  }

  /**
   * 处理 Centrifugo 反向代理订阅鉴权 (Proxy Subscribe Webhook 模式)
   */
  async handleProxySubscribe(dto: CentrifugoProxySubscribeDto): Promise<CentrifugoProxyResponseDto> {
    // Proxy 模式下 Centrifugo 会在订阅附带载荷中透传用户画像（email / role）
    const userData = (dto.data ?? {}) as Record<string, unknown>;
    const userPayload: CurrentUserPayload = {
      id: dto.user || '',
      email: (userData.email as string) || '',
      role: (userData.role as Role) || Role.USER,
    };

    const authResult = await this.realtimeService.canSubscribe(userPayload, dto.channel);
    if (!authResult.authorized) {
      this.logger.warn(
        `[Realtime] Centrifugo Proxy 订阅鉴权拒绝: channel=[${dto.channel}], user=[${dto.user}], reason=${authResult.reason}`,
      );
      return {
        error: {
          code: 103,
          message: authResult.reason ?? 'Permission denied',
        },
      };
    }

    this.logger.debug(`[Realtime] Centrifugo Proxy 订阅鉴权通过: channel=[${dto.channel}], user=[${dto.user}]`);
    return {
      result: {},
    };
  }

  /**
   * 监听领域事件：特定用户通知派发
   */
  @OnEvent('notification.sent')
  async handleNotificationSent(event: NotificationSentEvent): Promise<void> {
    if (!event.userId) return;
    this.logger.debug(`[Realtime] 接收到单播通知事件，准备推送到用户 [${event.userId}]`);

    // 规范单一推流：直接通过 Centrifugo 用户专属通道推送 (user#${userId})，彻底终结 4 倍网络放大
    await this.realtimeService.sendToUser(event.userId, 'notification', event.payload);
  }

  /**
   * 监听领域事件：全站广播通知
   */
  @OnEvent('notification.broadcast')
  async handleNotificationBroadcast(event: NotificationBroadcastEvent): Promise<void> {
    this.logger.debug('[Realtime] 接收到广播通知事件，准备进行全站实时推送');

    // 规范单一推流：推送到全站广播频道
    await this.realtimeService.broadcast(REALTIME_CHANNELS.BROADCAST_NOTIFICATION, 'notification', event.payload);
  }

  /**
   * 监听领域事件：工业设备遥测实时到达
   */
  @OnEvent(IOT_EVENTS.TELEMETRY_RECEIVED)
  async handleIotTelemetry(event: IotTelemetryReceivedEvent): Promise<void> {
    this.logger.debug(`[Realtime] 接收到设备 [${event.deviceId}] 遥测事件，准备下发推流`);
    const payload = {
      deviceId: event.deviceId,
      tenantId: event.tenantId,
      telemetry: event.telemetry,
      timestamp: event.timestamp,
    };

    await this.broadcastDeviceChannel(event.deviceId, 'telemetry', payload);
  }

  /**
   * 监听领域事件：工业设备上下线/遗嘱状态变更
   */
  @OnEvent(IOT_EVENTS.STATUS_CHANGED)
  async handleIotStatusChanged(event: IotDeviceStatusChangedEvent): Promise<void> {
    this.logger.debug(`[Realtime] 接收到设备 [${event.deviceId}] 状态变更事件: ${event.status}`);
    const payload = {
      deviceId: event.deviceId,
      tenantId: event.tenantId,
      status: event.status,
      reason: event.reason,
      timestamp: event.timestamp,
    };

    await this.broadcastDeviceChannel(event.deviceId, 'status', payload);
  }

  /**
   * 监听领域事件：工业设备超温/故障告警
   */
  @OnEvent(IOT_EVENTS.ALARM_TRIGGERED)
  async handleIotAlarmTriggered(event: IotAlarmTriggeredEvent): Promise<void> {
    this.logger.warn(`[Realtime] 接收到设备 [${event.deviceId}] 告警事件: ${event.message}`);
    // 1. 设备专属规范频道
    await this.broadcastDeviceChannel(event.deviceId, 'alarm', event);

    // 2. 全系统告警中枢规范频道
    await this.realtimeService.broadcast(REALTIME_CHANNELS.IOT_ALARMS, 'alarm', event);
  }

  /**
   * 监听领域事件：工业指令执行与回执完成
   */
  @OnEvent(IOT_EVENTS.COMMAND_EXECUTED)
  async handleIotCommandExecuted(event: IotCommandExecutedEvent): Promise<void> {
    this.logger.debug(`[Realtime] 接收到设备 [${event.deviceId}] 指令 [${event.command}] 回执事件`);
    await this.broadcastDeviceChannel(event.deviceId, 'command_receipt', event);
  }

  /**
   * 辅助方法：向设备专属规范频道广播消息
   */
  private async broadcastDeviceChannel<T>(deviceId: string, event: string, payload: T): Promise<void> {
    const canonicalChannel = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', deviceId);
    await this.realtimeService.broadcast(canonicalChannel, event, payload);
  }

  /**
   * 主动向指定实时频道广播数据
   */
  async broadcast<T = unknown>(channel: string, event: string, data: T): Promise<void> {
    await this.realtimeService.broadcast(channel, event, data);
  }

  /**
   * 主动向指定用户的所有连接派发数据
   */
  async sendToUser<T = unknown>(userId: string, event: string, data: T): Promise<void> {
    await this.realtimeService.sendToUser(userId, event, data);
  }
}

// 兼容别名导出
export const WebsocketService = RealtimeEventsService;
export type WebsocketService = RealtimeEventsService;
export const SseService = RealtimeEventsService;
export type SseService = RealtimeEventsService;

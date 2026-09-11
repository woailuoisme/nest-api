import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import type { RealtimeSubscribeResponseDto, RealtimeTokenResponseDto } from './dto/realtime.dto';
import { RealtimeService } from './realtime.service';

/**
 * 统一实时业务与通信事件中枢服务 (RealtimeEventsService)
 * 1. 负责长连接 Token 签发与订阅鉴权（支持 WebSocket 与 SSE 双协议）；
 * 2. 集中监听系统与业务领域事件，通过 Centrifugo 规范频道下发，同时兼容推送历史 ws/sse 频道。
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
   * 处理私有频道订阅鉴权
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
   * 监听领域事件：特定用户通知派发
   */
  @OnEvent('notification.sent')
  async handleNotificationSent(event: NotificationSentEvent): Promise<void> {
    if (!event.userId) return;
    this.logger.debug(`[Realtime] 接收到单播通知事件，准备推送到用户 [${event.userId}]`);

    // 1. 推送到规范频道
    const canonicalChannel = REALTIME_CHANNELS.USER_NOTIFICATION.replace('{userId}', event.userId);
    await this.realtimeService.broadcast(canonicalChannel, 'notification', event.payload);

    // 2. 兼容模式：推送到历史 ws 与 sse 专属频道
    const wsChannel = REALTIME_CHANNELS.WS_USER_NOTIFICATION.replace('{userId}', event.userId);
    const sseChannel = REALTIME_CHANNELS.SSE_USER_NOTIFICATION.replace('{userId}', event.userId);
    await this.realtimeService.broadcast(wsChannel, 'notification', event.payload);
    await this.realtimeService.broadcast(sseChannel, 'notification', event.payload);

    // 3. 推送到 Centrifugo 默认用户级推流 (sendToUser)
    await this.realtimeService.sendToUser(event.userId, 'notification', event.payload);
  }

  /**
   * 监听领域事件：全站广播通知
   */
  @OnEvent('notification.broadcast')
  async handleNotificationBroadcast(event: NotificationBroadcastEvent): Promise<void> {
    this.logger.debug('[Realtime] 接收到广播通知事件，准备进行全站实时推送');

    // 1. 推送到规范广播频道
    await this.realtimeService.broadcast(REALTIME_CHANNELS.BROADCAST_NOTIFICATION, 'notification', event.payload);

    // 2. 兼容模式：推送到历史 ws 与 sse 广播频道
    await this.realtimeService.broadcast(REALTIME_CHANNELS.WS_BROADCAST_NOTIFICATION, 'notification', event.payload);
    await this.realtimeService.broadcast(REALTIME_CHANNELS.SSE_BROADCAST_NOTIFICATION, 'notification', event.payload);
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

    await this.broadcastDeviceTriple(event.deviceId, 'telemetry', payload);
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

    await this.broadcastDeviceTriple(event.deviceId, 'status', payload);
  }

  /**
   * 监听领域事件：工业设备超温/故障告警
   */
  @OnEvent(IOT_EVENTS.ALARM_TRIGGERED)
  async handleIotAlarmTriggered(event: IotAlarmTriggeredEvent): Promise<void> {
    this.logger.warn(`[Realtime] 接收到设备 [${event.deviceId}] 告警事件: ${event.message}`);
    // 1. 设备专属频道（规范 + 兼容）
    await this.broadcastDeviceTriple(event.deviceId, 'alarm', event);

    // 2. 全系统告警中枢频道（规范 + 兼容）
    await this.realtimeService.broadcast(REALTIME_CHANNELS.IOT_ALARMS, 'alarm', event);
    await this.realtimeService.broadcast(REALTIME_CHANNELS.WS_IOT_ALARMS, 'alarm', event);
    await this.realtimeService.broadcast(REALTIME_CHANNELS.SSE_IOT_ALARMS, 'alarm', event);
  }

  /**
   * 监听领域事件：工业指令执行与回执完成
   */
  @OnEvent(IOT_EVENTS.COMMAND_EXECUTED)
  async handleIotCommandExecuted(event: IotCommandExecutedEvent): Promise<void> {
    this.logger.debug(`[Realtime] 接收到设备 [${event.deviceId}] 指令 [${event.command}] 回执事件`);
    await this.broadcastDeviceTriple(event.deviceId, 'command_receipt', event);
  }

  /**
   * 辅助方法：向设备专属三合一频道（规范频道 + WebSocket 兼容 + SSE 兼容）广播消息
   */
  private async broadcastDeviceTriple<T>(deviceId: string, event: string, payload: T): Promise<void> {
    const canonicalChannel = REALTIME_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', deviceId);
    const wsChannel = REALTIME_CHANNELS.WS_DEVICE_TELEMETRY.replace('{deviceId}', deviceId);
    const sseChannel = REALTIME_CHANNELS.SSE_DEVICE_TELEMETRY.replace('{deviceId}', deviceId);

    await this.realtimeService.broadcast(canonicalChannel, event, payload);
    await this.realtimeService.broadcast(wsChannel, event, payload);
    await this.realtimeService.broadcast(sseChannel, event, payload);
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

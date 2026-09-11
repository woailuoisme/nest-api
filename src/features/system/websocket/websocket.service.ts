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
import { RealtimeService } from '@/common/realtime/realtime.service';
import type { WebsocketSubscribeResponseDto, WebsocketTokenResponseDto } from './dto/websocket.dto';
import { WS_CHANNELS } from './websocket-channels.service';

/**
 * WebSocket 业务与通信中枢服务
 * 1. 负责长连接 Token 签发与订阅鉴权；
 * 2. 集中监听系统/业务领域的异步事件，完成 WebSocket 协议通道的数据转换与投递。
 */
@Injectable()
export class WebsocketService {
  private readonly logger = new Logger(WebsocketService.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * 为客户端签发 WebSocket 专属连接 Token
   */
  createConnectionToken(user: CurrentUserPayload): WebsocketTokenResponseDto {
    const result = this.realtimeService.createConnectionToken(user);
    return {
      token: result.token,
      url: this.realtimeService.getWsUrl(),
    };
  }

  /**
   * 处理 WebSocket 私有频道订阅鉴权
   */
  async subscribeChannel(
    user: CurrentUserPayload,
    channel: string,
    client: string,
  ): Promise<WebsocketSubscribeResponseDto> {
    return this.realtimeService.authorizeSubscription(user, { channel, client });
  }

  /**
   * 监听领域事件：特定用户通知派发
   */
  @OnEvent('notification.sent')
  async handleNotificationSent(event: NotificationSentEvent): Promise<void> {
    if (!event.userId) return;
    this.logger.debug(`[WebSocket] 接收到单播通知事件，准备推送到用户 [${event.userId}]`);

    // 1. 推送到用户专属 WebSocket 频道
    const wsChannel = WS_CHANNELS.USER_NOTIFICATION.replace('{userId}', event.userId);
    await this.realtimeService.broadcast(wsChannel, 'notification', event.payload);

    // 2. 推送到 Centrifugo 默认用户级推流 (sendToUser)
    await this.realtimeService.sendToUser(event.userId, 'notification', event.payload);
  }

  /**
   * 监听领域事件：全站广播通知
   */
  @OnEvent('notification.broadcast')
  async handleNotificationBroadcast(event: NotificationBroadcastEvent): Promise<void> {
    this.logger.debug('[WebSocket] 接收到广播通知事件，准备进行全站推送');

    // 1. 推送到专用 WebSocket 广播频道
    await this.realtimeService.broadcast(WS_CHANNELS.BROADCAST_NOTIFICATION, 'notification', event.payload);

    // 2. 推送到兼容广播频道
    await this.realtimeService.broadcast(WS_CHANNELS.COMPAT_BROADCAST_NOTIFICATION, 'notification', event.payload);
  }

  /**
   * 监听领域事件：工业设备遥测实时到达
   */
  @OnEvent(IOT_EVENTS.TELEMETRY_RECEIVED)
  async handleIotTelemetry(event: IotTelemetryReceivedEvent): Promise<void> {
    this.logger.debug(`[WebSocket] 接收到设备 [${event.deviceId}] 遥测事件，准备下发推流`);
    const channel = WS_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', event.deviceId);
    await this.realtimeService.broadcast(channel, 'telemetry', {
      deviceId: event.deviceId,
      tenantId: event.tenantId,
      telemetry: event.telemetry,
      timestamp: event.timestamp,
    });
  }

  /**
   * 监听领域事件：工业设备上下线/遗嘱状态变更
   */
  @OnEvent(IOT_EVENTS.STATUS_CHANGED)
  async handleIotStatusChanged(event: IotDeviceStatusChangedEvent): Promise<void> {
    this.logger.debug(`[WebSocket] 接收到设备 [${event.deviceId}] 状态变更事件: ${event.status}`);
    const channel = WS_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', event.deviceId);
    await this.realtimeService.broadcast(channel, 'status', {
      deviceId: event.deviceId,
      tenantId: event.tenantId,
      status: event.status,
      reason: event.reason,
      timestamp: event.timestamp,
    });
  }

  /**
   * 监听领域事件：工业设备超温/故障告警
   */
  @OnEvent(IOT_EVENTS.ALARM_TRIGGERED)
  async handleIotAlarmTriggered(event: IotAlarmTriggeredEvent): Promise<void> {
    this.logger.warn(`[WebSocket] 接收到设备 [${event.deviceId}] 告警事件: ${event.message}`);
    // 1. 推送到设备专属频道
    const deviceChannel = WS_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', event.deviceId);
    await this.realtimeService.broadcast(deviceChannel, 'alarm', event);

    // 2. 广播到全系统告警中枢频道
    await this.realtimeService.broadcast(WS_CHANNELS.IOT_ALARMS, 'alarm', event);
  }

  /**
   * 监听领域事件：工业指令执行与回执完成
   */
  @OnEvent(IOT_EVENTS.COMMAND_EXECUTED)
  async handleIotCommandExecuted(event: IotCommandExecutedEvent): Promise<void> {
    this.logger.debug(`[WebSocket] 接收到设备 [${event.deviceId}] 指令 [${event.command}] 回执事件`);
    const channel = WS_CHANNELS.DEVICE_TELEMETRY.replace('{deviceId}', event.deviceId);
    await this.realtimeService.broadcast(channel, 'command_receipt', event);
  }

  /**
   * 主动向指定 WebSocket 频道广播数据
   */
  async broadcast<T = unknown>(channel: string, event: string, data: T): Promise<void> {
    await this.realtimeService.broadcast(channel, event, data);
  }

  /**
   * 主动向指定用户的所有 WebSocket 连接派发数据
   */
  async sendToUser<T = unknown>(userId: string, event: string, data: T): Promise<void> {
    await this.realtimeService.sendToUser(userId, event, data);
  }
}

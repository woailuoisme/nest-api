import { Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { RealtimeChannelInfoDto } from '../dto/realtime.dto';
import { ChannelAuth } from './decorators/channel-auth.decorator';

export const REALTIME_CHANNELS = {
  // 规范命名 (Canonical)
  USER_NOTIFICATION: 'private:notifications.{userId}',
  BROADCAST_NOTIFICATION: 'notifications',
  DEVICE_TELEMETRY: 'devices.{deviceId}',
  IOT_ALARMS: 'iot:alarms',

  // 历史兼容别名：WebSocket (ws:)
  WS_USER_NOTIFICATION: 'private:ws:notifications.{userId}',
  WS_BROADCAST_NOTIFICATION: 'ws:notifications',
  WS_DEVICE_TELEMETRY: 'ws:devices.{deviceId}',
  WS_IOT_ALARMS: 'ws:iot:alarms',

  // 历史兼容别名：SSE (sse:)
  SSE_USER_NOTIFICATION: 'private:sse:notifications.{userId}',
  SSE_BROADCAST_NOTIFICATION: 'sse:notifications',
  SSE_DEVICE_TELEMETRY: 'sse:devices.{deviceId}',
  SSE_IOT_ALARMS: 'sse:iot:alarms',
} as const;

// 兼容别名导出
export const WS_CHANNELS = REALTIME_CHANNELS;
export const SSE_CHANNELS = REALTIME_CHANNELS;

/**
 * 统一实时频道定义与鉴权管理服务 (RealtimeChannelsService)
 * 集中管理所有实时推送频道的路由模式与准入校验闭包，杜绝业务模块分散侵入。
 * 同时无缝兼容 WebSocket 与 SSE 客户端订阅。
 */
@Injectable()
export class RealtimeChannelsService {
  /**
   * 用户专属私有通知频道鉴权（规范模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.USER_NOTIFICATION)
  authorizeUserNotification(user: CurrentUserPayload, params: Record<string, string>): boolean {
    if (!user || !params) return false;
    return user.id === params.userId;
  }

  /**
   * 用户专属私有通知频道鉴权（WebSocket 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.WS_USER_NOTIFICATION)
  authorizeWsUserNotification(user: CurrentUserPayload, params: Record<string, string>): boolean {
    return this.authorizeUserNotification(user, params);
  }

  /**
   * 用户专属私有通知频道鉴权（SSE 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.SSE_USER_NOTIFICATION)
  authorizeSseUserNotification(user: CurrentUserPayload, params: Record<string, string>): boolean {
    return this.authorizeUserNotification(user, params);
  }

  /**
   * 工业设备实时遥测与状态推流频道鉴权（规范模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.DEVICE_TELEMETRY)
  authorizeDeviceTelemetry(user: CurrentUserPayload, params: Record<string, string>): boolean {
    if (!user || !params?.deviceId) return false;
    return true;
  }

  /**
   * 工业设备实时遥测与状态推流频道鉴权（WebSocket 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.WS_DEVICE_TELEMETRY)
  authorizeWsDeviceTelemetry(user: CurrentUserPayload, params: Record<string, string>): boolean {
    return this.authorizeDeviceTelemetry(user, params);
  }

  /**
   * 工业设备实时遥测与状态推流频道鉴权（SSE 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.SSE_DEVICE_TELEMETRY)
  authorizeSseDeviceTelemetry(user: CurrentUserPayload, params: Record<string, string>): boolean {
    return this.authorizeDeviceTelemetry(user, params);
  }

  /**
   * 全局工业设备告警广播频道鉴权（规范模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.IOT_ALARMS)
  authorizeIotAlarms(user: CurrentUserPayload): boolean {
    return Boolean(user?.id);
  }

  /**
   * 全局工业设备告警广播频道鉴权（WebSocket 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.WS_IOT_ALARMS)
  authorizeWsIotAlarms(user: CurrentUserPayload): boolean {
    return this.authorizeIotAlarms(user);
  }

  /**
   * 全局工业设备告警广播频道鉴权（SSE 兼容模式）
   */
  @ChannelAuth(REALTIME_CHANNELS.SSE_IOT_ALARMS)
  authorizeSseIotAlarms(user: CurrentUserPayload): boolean {
    return this.authorizeIotAlarms(user);
  }

  /**
   * 获取当前实时模块注册的所有频道元数据
   */
  listRegisteredChannels(): RealtimeChannelInfoDto[] {
    return [
      {
        pattern: REALTIME_CHANNELS.USER_NOTIFICATION,
        description: '用户专属即时通知频道（单播，规范模式）',
        isPrivate: true,
      },
      {
        pattern: REALTIME_CHANNELS.BROADCAST_NOTIFICATION,
        description: '全站广播通知频道（公共，规范模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.DEVICE_TELEMETRY,
        description: '工业设备遥测实时推流频道（按设备路由，规范模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.IOT_ALARMS,
        description: '全系统工业设备告警广播频道（公共，规范模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.WS_USER_NOTIFICATION,
        description: '用户专属 WebSocket 即时通知频道（单播，兼容模式）',
        isPrivate: true,
      },
      {
        pattern: REALTIME_CHANNELS.WS_BROADCAST_NOTIFICATION,
        description: '全站 WebSocket 广播通知频道（公共，兼容模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.WS_DEVICE_TELEMETRY,
        description: '工业设备遥测 WebSocket 推流频道（兼容模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.WS_IOT_ALARMS,
        description: '全系统工业设备告警 WebSocket 广播频道（兼容模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.SSE_USER_NOTIFICATION,
        description: '用户专属 SSE 单向流通知频道（单播，兼容模式）',
        isPrivate: true,
      },
      {
        pattern: REALTIME_CHANNELS.SSE_BROADCAST_NOTIFICATION,
        description: '全站 SSE 广播通知频道（公共，兼容模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.SSE_DEVICE_TELEMETRY,
        description: '工业设备遥测 SSE 推流频道（兼容模式）',
        isPrivate: false,
      },
      {
        pattern: REALTIME_CHANNELS.SSE_IOT_ALARMS,
        description: '全系统工业设备告警 SSE 广播频道（兼容模式）',
        isPrivate: false,
      },
    ];
  }
}

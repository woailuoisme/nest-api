import { Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelAuth } from '@/common/realtime/channels/decorators/channel-auth.decorator';
import type { SseChannelInfoDto } from './dto/sse.dto';

export const SSE_CHANNELS = {
  USER_NOTIFICATION: 'private:sse:notifications.{userId}',
  BROADCAST_NOTIFICATION: 'sse:notifications',
  COMPAT_USER_NOTIFICATION: 'private:notifications.{userId}',
  COMPAT_BROADCAST_NOTIFICATION: 'notifications',
  DEVICE_TELEMETRY: 'sse:devices.{deviceId}',
  IOT_ALARMS: 'sse:iot:alarms',
} as const;

/**
 * SSE 频道定义与鉴权管理服务
 * 集中管理所有 Server-Sent Events 频道的路由模式与准入校验逻辑。
 */
@Injectable()
export class SseChannelsService {
  /**
   * 用户专属 SSE 私有推送频道鉴权
   * 仅允许当前登录用户订阅属于自己的通知流
   */
  @ChannelAuth(SSE_CHANNELS.USER_NOTIFICATION)
  authorizeUserNotification(user: CurrentUserPayload, params: Record<string, string>): boolean {
    if (!user || !params) return false;
    return user.id === params.userId;
  }

  /**
   * 兼容模式：传统私有通知频道鉴权
   */
  @ChannelAuth(SSE_CHANNELS.COMPAT_USER_NOTIFICATION)
  authorizeCompatUserNotification(user: CurrentUserPayload, params: Record<string, string>): boolean {
    if (!user || !params) return false;
    return user.id === params.userId;
  }

  /**
   * 工业设备实时遥测与状态推流频道鉴权
   * 允许合法登录用户监听指定设备的 SSE 事件流
   */
  @ChannelAuth(SSE_CHANNELS.DEVICE_TELEMETRY)
  authorizeDeviceTelemetry(user: CurrentUserPayload, params: Record<string, string>): boolean {
    if (!user || !params?.deviceId) return false;
    return true;
  }

  /**
   * 全局工业设备告警广播频道鉴权
   * 允许登录用户订阅设备异常及超温等告警事件流
   */
  @ChannelAuth(SSE_CHANNELS.IOT_ALARMS)
  authorizeIotAlarms(user: CurrentUserPayload): boolean {
    return Boolean(user?.id);
  }

  /**
   * 获取当前 SSE 模块注册的所有频道元数据
   */
  listRegisteredChannels(): SseChannelInfoDto[] {
    return [
      {
        pattern: SSE_CHANNELS.USER_NOTIFICATION,
        description: '用户专属 SSE 单向流通知频道（单播）',
        isPrivate: true,
      },
      {
        pattern: SSE_CHANNELS.BROADCAST_NOTIFICATION,
        description: '全站 SSE 广播通知频道（公共）',
        isPrivate: false,
      },
      {
        pattern: SSE_CHANNELS.COMPAT_USER_NOTIFICATION,
        description: '兼容通道：私有用户通知频道',
        isPrivate: true,
      },
      {
        pattern: SSE_CHANNELS.COMPAT_BROADCAST_NOTIFICATION,
        description: '兼容通道：全站公共广播频道',
        isPrivate: false,
      },
      {
        pattern: SSE_CHANNELS.DEVICE_TELEMETRY,
        description: '工业设备遥测实时推流频道（按设备路由）',
        isPrivate: false,
      },
      {
        pattern: SSE_CHANNELS.IOT_ALARMS,
        description: '全系统工业设备告警广播频道（公共）',
        isPrivate: false,
      },
    ];
  }
}

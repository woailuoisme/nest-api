import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RealtimeService } from '@/realtime/realtime.service';
import type { NotificationPayload, SendNotificationDto } from './notifications.dto';

/**
 * 业务通知领域服务：
 * 作为纯业务服务，将通知派发委托给底层统一 RealtimeService，实现 SSE 与 WebSocket 双通道精准同步投递。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * 向特定用户发送实时通知
   */
  sendToUser(userId: number, dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    const payload = this.createPayload(dto);
    this.realtimeService.sendToUser(userId, 'notification', payload);
    return payload;
  }

  /**
   * 向全站所有在线用户广播实时通知
   */
  broadcast(dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    const payload = this.createPayload(dto);
    this.realtimeService.broadcast('notifications', 'notification', payload);
    return payload;
  }

  private createPayload(dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    return {
      id: randomUUID(),
      title: dto.title,
      message: dto.message,
      type: dto.type ?? 'info',
      timestamp: Date.now(),
      metadata: dto.metadata,
    };
  }
}

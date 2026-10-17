import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';

import type { NotificationPayload, SendNotificationDto } from './notifications.dto';

/**
 * 业务通知领域服务：
 * 作为纯业务服务，仅发布通知领域事件（notification.sent / notification.broadcast），
 * 与下层具体的通信协议（WebSocket、SSE）完全解耦。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 向特定用户发送实时通知
   */
  sendToUser(userId: string, dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    const payload = this.createPayload(dto);
    this.eventEmitter.emit('notification.sent', { userId, payload });
    return payload;
  }

  /**
   * 向全站所有在线用户广播实时通知
   */
  broadcast(dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    const payload = this.createPayload(dto);
    this.eventEmitter.emit('notification.broadcast', { payload });
    return payload;
  }

  private createPayload(dto: Omit<SendNotificationDto, 'userId'>): NotificationPayload {
    return {
      id: uuidv7(),
      title: dto.title,
      message: dto.message,
      type: dto.type ?? 'info',
      timestamp: Date.now(),
      metadata: dto.metadata,
    };
  }
}

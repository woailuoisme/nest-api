export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  type: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationSentEvent {
  userId: string;
  payload: NotificationPayload;
}

export interface NotificationBroadcastEvent {
  payload: NotificationPayload;
}

/** 通知领域事件名：emit 端与 @OnEvent 端共用，避免字符串两侧手写漂移 */
export const NOTIFICATION_EVENTS = {
  SENT: 'notification.sent',
  BROADCAST: 'notification.broadcast',
} as const;

export type NotificationEventName = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

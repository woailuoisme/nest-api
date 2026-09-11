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

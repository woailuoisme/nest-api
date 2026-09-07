import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const NotificationTypeSchema = z.enum(['info', 'warning', 'success', 'error']);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const SendNotificationSchema = z.object({
  userId: z.coerce.number().int().positive().describe('接收通知的目标用户 ID'),
  title: z.string().trim().min(1).max(100).describe('通知标题'),
  message: z.string().trim().min(1).max(500).describe('通知详细内容'),
  type: NotificationTypeSchema.default('info').describe('通知级别：info | warning | success | error'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('附加结构化元数据'),
});

export class SendNotificationDto extends createZodDto(SendNotificationSchema) {}

/** SSE 流中派发给客户端的标准化通知负载 */
export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

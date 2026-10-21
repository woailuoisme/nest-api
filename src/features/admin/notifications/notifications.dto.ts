import { z } from 'zod';

export const NotificationTypeSchema = z.enum(['info', 'warning', 'success', 'error']);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

// strict: 未知字段当前静默丢弃（z.object strip）；新增写接口应改用 z.strictObject
export const SendNotificationSchema = z.object({
  userId: z.string().min(1).describe('接收通知的目标用户 ID'),
  title: z.string().trim().min(1).max(100).describe('通知标题'),
  message: z.string().trim().min(1).max(500).describe('通知详细内容'),
  type: NotificationTypeSchema.default('info').describe('通知级别：info | warning | success | error'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('附加结构化元数据'),
});

export type SendNotificationDto = z.infer<typeof SendNotificationSchema>;

/** SSE 流与接口返回的标准化通知负载实体模型（同一 schema 驱动 OpenAPI 文档与运行时序列化） */
export const NotificationEntitySchema = z.object({
  id: z.string().describe('通知唯一 ID'),
  title: z.string().describe('通知标题'),
  message: z.string().describe('通知详细内容'),
  type: NotificationTypeSchema.describe('通知级别：info | warning | success | error'),
  timestamp: z.number().describe('生成时间戳 (毫秒)'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('附加结构化元数据'),
});

export type NotificationEntity = z.infer<typeof NotificationEntitySchema>;

export type NotificationPayload = z.infer<typeof NotificationEntitySchema>;

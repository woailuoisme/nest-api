import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * 实时事件通用消息结构
 */
export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string | null;
  data: T;
  timestamp: number;
}

/**
 * 频道订阅凭据请求 DTO
 */
export const RealtimeSubscribeSchema = z.object({
  channel: z.string().min(1, 'channel 不能为空'),
  client: z.string().optional(),
});

export class RealtimeSubscribeDto extends createZodDto(RealtimeSubscribeSchema) {}

/**
 * 连接 Token 响应结构
 */
export interface RealtimeTokenResponse {
  token: string;
  expiresAt: number;
}

/**
 * 频道订阅 Token 响应结构
 */
export interface RealtimeSubscribeResponse {
  token: string;
  channel: string;
  expiresAt: number;
}

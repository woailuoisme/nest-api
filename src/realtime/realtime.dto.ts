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
 * Pusher / Soketi 频道订阅鉴权请求 DTO
 */
export const PusherAuthSchema = z.object({
  socket_id: z.string().min(1, 'socket_id 不能为空'),
  channel_name: z.string().min(1, 'channel_name 不能为空'),
});

export class PusherAuthDto extends createZodDto(PusherAuthSchema) {}

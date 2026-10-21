import type { RealtimeEnvelope } from '../dto/realtime.dto';

export const REALTIME_PRIMARY_TRANSPORT = 'REALTIME_PRIMARY_TRANSPORT';

/**
 * 实时传输层统一契约 (Transport Seam)
 * 允许在不同通信协议 (SSE, WebSocket, In-Memory Fake, Redis) 之间以可插拔形式替换与组合。
 */
export interface RealtimeTransport {
  readonly name: string;
  sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): void | Promise<void>;
  broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): void | Promise<void>;
}

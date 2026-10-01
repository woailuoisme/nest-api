import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * 实时事件通用消息信封结构 (RealtimeEnvelope)
 */
export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string | null;
  data: T;
  timestamp: number;
}

/**
 * 实时长连接 Token 查询 DTO Schema
 */
export const RealtimeTokenQuerySchema = z.object({
  protocol: z.enum(['websocket', 'sse']).default('websocket').optional(),
});

export type RealtimeTokenQueryDto = z.infer<typeof RealtimeTokenQuerySchema>;

/**
 * 长连接 Token 响应 DTO
 */
export class RealtimeTokenResponseDto {
  @ApiProperty({ description: '长连接 JWT 鉴权凭据' })
  token!: string;

  @ApiProperty({
    description: 'Centrifugo 终端连接地址',
    example: 'ws://127.0.0.1:8000/connection/websocket',
  })
  url!: string;

  @ApiPropertyOptional({
    description: '连接传输协议类型',
    enum: ['websocket', 'sse'],
    example: 'websocket',
  })
  protocol?: 'websocket' | 'sse';
}

/**
 * 基础连接 Token 响应结构接口
 */
export interface RealtimeTokenResponse {
  token: string;
  expiresAt: number;
}

/**
 * 频道订阅凭据请求 DTO Schema
 */
export const RealtimeSubscribeSchema = z.object({
  channel: z.string().min(1, 'channel 不能为空'),
  client: z.string().optional(),
});

export type RealtimeSubscribeDto = z.infer<typeof RealtimeSubscribeSchema>;

/**
 * 频道订阅响应 DTO
 */
export class RealtimeSubscribeResponseDto {
  @ApiProperty({ description: '频道专属订阅 Token' })
  token!: string;
}

/**
 * 频道订阅 Token 响应结构接口
 */
export interface RealtimeSubscribeResponse {
  token: string;
  channel: string;
  expiresAt: number;
}

/**
 * 频道规则信息 DTO
 */
export class RealtimeChannelInfoDto {
  @ApiProperty({ description: '频道路由模式', example: 'private:notifications.{userId}' })
  pattern!: string;

  @ApiProperty({ description: '频道用途说明', example: '用户私有通知频道' })
  description!: string;

  @ApiProperty({ description: '是否为私有安全鉴权频道', example: true })
  isPrivate!: boolean;
}

/**
 * Centrifugo Proxy Webhook 频道订阅鉴权请求 DTO Schema
 */
export const CentrifugoProxySubscribeSchema = z.object({
  client: z.string().optional(),
  transport: z.string().optional(),
  protocol: z.string().optional(),
  encoding: z.string().optional(),
  user: z.string().default(''),
  channel: z.string().min(1, 'channel 不能为空'),
  data: z.unknown().optional(),
  bidi: z.boolean().optional(),
});

export type CentrifugoProxySubscribeDto = z.infer<typeof CentrifugoProxySubscribeSchema>;

/**
 * Centrifugo Proxy Webhook 响应错误对象
 */
export class CentrifugoProxyErrorDto {
  @ApiProperty({ description: 'Centrifugo 协议错误码 (如 103 PermissionDenied)', example: 103 })
  code!: number;

  @ApiProperty({ description: '错误描述信息', example: 'Permission denied' })
  message!: string;
}

/**
 * Centrifugo Proxy Webhook 频道订阅统一响应 DTO
 */
export class CentrifugoProxyResponseDto {
  @ApiPropertyOptional({ description: '准入成功时的结果对象' })
  result?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '鉴权失败时的错误对象', type: CentrifugoProxyErrorDto })
  error?: CentrifugoProxyErrorDto;
}

// 兼容别名导出，确保历史引用零侵入
export type WebsocketTokenQueryDto = RealtimeTokenQueryDto;
export type WebsocketTokenResponseDto = RealtimeTokenResponseDto;
export type WebsocketSubscribeDto = RealtimeSubscribeDto;
export type WebsocketSubscribeResponseDto = RealtimeSubscribeResponseDto;
export type WebsocketChannelInfoDto = RealtimeChannelInfoDto;

export type SseTokenQueryDto = RealtimeTokenQueryDto;
export type SseTokenResponseDto = RealtimeTokenResponseDto;
export type SseSubscribeDto = RealtimeSubscribeDto;
export type SseSubscribeResponseDto = RealtimeSubscribeResponseDto;
export type SseChannelInfoDto = RealtimeChannelInfoDto;

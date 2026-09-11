import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
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

export class RealtimeTokenQueryDto extends createZodDto(RealtimeTokenQuerySchema) {
  @ApiPropertyOptional({
    description: '连接传输协议类型 (websocket 或 sse)，默认 websocket',
    enum: ['websocket', 'sse'],
    default: 'websocket',
  })
  protocol?: 'websocket' | 'sse' = 'websocket';
}

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

export class RealtimeSubscribeDto extends createZodDto(RealtimeSubscribeSchema) {
  @ApiProperty({ description: '待订阅的频道全名', example: 'private:notifications.user_123' })
  channel!: string;

  @ApiPropertyOptional({ description: '客户端全局唯一 Client ID', example: 'client_xyz789' })
  client?: string;
}

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

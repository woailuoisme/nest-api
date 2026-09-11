import { ApiProperty } from '@nestjs/swagger';

export class SseTokenResponseDto {
  @ApiProperty({ description: 'SSE 长连接 JWT 凭据' })
  token!: string;

  @ApiProperty({ description: 'Centrifugo SSE 终端地址', example: 'http://127.0.0.1:8000/connection/sse' })
  url!: string;
}

export class SseSubscribeDto {
  @ApiProperty({ description: '待订阅的 SSE 频道全名', example: 'private:sse:notifications.user_123' })
  channel!: string;

  @ApiProperty({ description: '客户端全局唯一 Client ID', example: 'client_sse456' })
  client!: string;
}

export class SseSubscribeResponseDto {
  @ApiProperty({ description: '频道专属订阅 Token' })
  token!: string;
}

export class SseChannelInfoDto {
  @ApiProperty({ description: '频道路由模式', example: 'private:sse:notifications.{userId}' })
  pattern!: string;

  @ApiProperty({ description: '频道用途说明', example: '用户私有服务端推送事件频道' })
  description!: string;

  @ApiProperty({ description: '是否为私有安全鉴权频道', example: true })
  isPrivate!: boolean;
}

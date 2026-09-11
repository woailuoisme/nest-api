import { ApiProperty } from '@nestjs/swagger';

export class WebsocketTokenResponseDto {
  @ApiProperty({ description: 'WebSocket 长连接 JWT 凭据' })
  token!: string;

  @ApiProperty({ description: 'Centrifugo WebSocket 终端地址', example: 'ws://127.0.0.1:8000/connection/websocket' })
  url!: string;
}

export class WebsocketSubscribeDto {
  @ApiProperty({ description: '待订阅的 WebSocket 频道全名', example: 'private:ws:notifications.user_123' })
  channel!: string;

  @ApiProperty({ description: '客户端全局唯一 Client ID', example: 'client_xyz789' })
  client!: string;
}

export class WebsocketSubscribeResponseDto {
  @ApiProperty({ description: '频道专属订阅 Token' })
  token!: string;
}

export class WebsocketChannelInfoDto {
  @ApiProperty({ description: '频道路由模式', example: 'private:ws:notifications.{userId}' })
  pattern!: string;

  @ApiProperty({ description: '频道用途说明', example: '用户私有通知频道' })
  description!: string;

  @ApiProperty({ description: '是否为私有安全鉴权频道', example: true })
  isPrivate!: boolean;
}

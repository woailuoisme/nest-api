import { Module } from '@nestjs/common';
import { WebsocketController } from './websocket.controller';
import { WebsocketService } from './websocket.service';
import { WebsocketChannelsService } from './websocket-channels.service';

/**
 * WebSocket 独立系统业务模块
 * 统一承载 WebSocket 协议下的频道规范、长连接鉴权、在线监控及领域事件推流。
 */
@Module({
  controllers: [WebsocketController],
  providers: [WebsocketService, WebsocketChannelsService],
  exports: [WebsocketService, WebsocketChannelsService],
})
export class WebsocketModule {}

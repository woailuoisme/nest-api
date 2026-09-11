import { Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { SseChannelsService } from './sse-channels.service';

/**
 * SSE 独立系统业务模块
 * 统一承载 Server-Sent Events 单向流推协议下的频道规范、长连接凭据签发与领域事件推流。
 */
@Module({
  controllers: [SseController],
  providers: [SseService, SseChannelsService],
  exports: [SseService, SseChannelsService],
})
export class SseModule {}

import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { IotModule } from './iot/iot.module';
import { SseModule } from './sse/sse.module';
import { SystemController } from './system.controller';
import { WebsocketModule } from './websocket/websocket.module';

/**
 * 系统/基础设施模块清单（统一系统探针端点：根心跳 `GET /` + 健康检查 `/health` + 物联网设备控制 `/v1/iot` + WebSocket `/v1/websocket` + SSE `/v1/sse`）
 *
 * 由 API_MODULES 统一纳入 AppModule 与 CliModule，确保路由发现与容器上下文对齐。
 */
@Module({
  imports: [HealthModule, IotModule, WebsocketModule, SseModule],
  controllers: [SystemController],
  exports: [HealthModule, IotModule, WebsocketModule, SseModule],
})
export class SystemModule {}

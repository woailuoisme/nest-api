import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { setupGlobalMiddleware } from './middleware';
import { type MountedPanel, registerOpsPanels } from './ops-panels';
import { registerFastifyPlugins } from './plugins';

/**
 * 编排并执行完整的应用引导管道：
 * 1. Fastify 原生安全插件与全链路 Hooks (Helmet, Static, Multipart, Upload 鉴权, x-request-id)
 * 2. 全局中间件、版本控制、验证管道、异常过滤器与响应转换拦截器
 * 3. WebSocket 网关适配器挂载
 * 4. 运行时运维面板（OpenAPI Scalar / Swagger, BullBoard, LogViewer）装配
 */
export async function setupApplicationPipeline(app: NestFastifyApplication): Promise<MountedPanel[]> {
  await registerFastifyPlugins(app);
  setupGlobalMiddleware(app);
  app.useWebSocketAdapter(new IoAdapter(app));
  return registerOpsPanels(app);
}

import 'dotenv/config';
// 必须早于其余 import：ESM import 会被提升，只有最先被导入的模块才能保证 SDK 最早初始化
import './setup/sentry';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { NETWORK } from './common/constants/app.constants';
import { setupTimezone } from './config/timezone';
import { createFastifyAdapter, PinoLoggerService, setupApplicationPipeline, setupShutdownHooks } from './setup';

/**
 * 主引导函数
 */
async function bootstrap() {
  const timezone = setupTimezone();
  const cookieSecret = process.env.COOKIE_SECRET;
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), {
    bufferLogs: true,
    rawBody: true,
    // 框架内置 Cookie 支持（opt-in）：仅当显式配置 COOKIE_SECRET 时启用，不凭空引入弱默认签名密钥
    ...(cookieSecret ? { cookies: { secret: cookieSecret } } : {}),
    // 路由冲突诊断：重复路由（method+path+version 完全一致）在注册前被拦截并直接拒绝启动。
    // 注：框架仅在「顺序敏感」适配器上应用 shadow 策略；Fastify 适配器 isRouteOrderSensitive() 为 false，
    // 其 radix 路由天然静态段优先（/users/me 不会被 /users/:id 遮蔽），故 shadow 与 routeResolutionStrategy 对 Fastify 均为 no-op，
    // 保留 shadow 仅为切换适配器时行为不退化。
    routeConflictPolicy: { duplicate: 'error', shadow: 'warn' },
  });

  setupShutdownHooks(app);
  const panels = await setupApplicationPipeline(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 3000;
  const appUrl = config.get<string>('APP_URL') ?? `http://localhost:${port}`;
  const isWorkerEmbedded = config.get<boolean>('WORKER_EMBEDDED');

  await app.listen(port, NETWORK.HOST_BINDING);

  app.get(PinoLoggerService).logStartupSummary({
    appUrl,
    timezone,
    isWorkerEmbedded,
    panels,
  });
}

bootstrap();

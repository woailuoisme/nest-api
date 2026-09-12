import 'dotenv/config';
import './instrumentation.js';
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
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), { bufferLogs: true });

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

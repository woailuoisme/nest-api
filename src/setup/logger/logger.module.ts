import { Global, Module } from '@nestjs/common';

import { createPinoLogger } from './logger.config';
import { PINO_LOGGER, PinoLoggerService } from './pino-logger.service';

/**
 * 全局日志模块 — 导出 Pino 实例与原生 LoggerService 实现。
 */
@Global()
@Module({
  providers: [
    {
      provide: PINO_LOGGER,
      useFactory: () => createPinoLogger(),
    },
    PinoLoggerService,
  ],
  exports: [PINO_LOGGER, PinoLoggerService],
})
export class LoggerModule {}

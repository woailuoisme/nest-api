import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';

import type { EnvConfig } from '@/config/env.validation';

import { DeadlineInterceptor } from './deadline.interceptor.js';

/**
 * 统一出站 HTTP 客户端模块 (HttpModule)
 *
 * 包装 NestJS 12 原生 `@nestjs/http-client`：
 * 1. 采用基于 Node.js 原生 fetch 与 undici 引擎的现代出站客户端，零 Axios 传递依赖；
 * 2. 默认挂载 DeadlineInterceptor，自动将 RequestContext 中的全链路剩余时间计算为墙钟死线 (Deadline Budget)；
 * 3. 默认关闭底层隐式自动重试，由上层领域逻辑配合 `@nestjs/resilience` 显式声明重试策略；
 * 4. 导出全局统一 HttpClient 实例与 named client 工厂。
 */
@Global()
@Module({
  imports: [
    HttpClientModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      interceptors: [DeadlineInterceptor],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        timeout: config.get('HTTP_TIMEOUT_MS', { infer: true }),
        retry: false,
      }),
    }),
  ],
  providers: [DeadlineInterceptor],
  exports: [HttpClientModule, DeadlineInterceptor],
})
export class HttpModule {}

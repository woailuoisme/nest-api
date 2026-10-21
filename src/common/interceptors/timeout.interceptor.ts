import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { finalize, type Observable } from 'rxjs';

import { RequestContext } from '@/common/context';
import { REQUEST_SIGNAL_SYMBOL } from '@/common/decorators/req-signal.decorator';
import {
  BYPASS_TIMEOUT_KEY,
  LEGACY_TIMEOUT_METADATA_KEY,
  TIMEOUT_METADATA_KEY,
} from '@/common/decorators/timeout.decorator';
import type { EnvConfig } from '@/config/env.validation';

/** 默认全局请求超时时间（毫秒） */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * 解析时间跨度为毫秒数：支持纯数字毫秒或时间字符串 (500ms, 5s, 1m)
 */
function parseDurationToMs(value: number | string | undefined, defaultMs: number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)(ms|s|m|h|d|w)?$/);
    if (match) {
      const num = Number.parseInt(match[1], 10);
      const unit = match[2] ?? 'ms';
      switch (unit) {
        case 'ms':
          return num;
        case 's':
          return num * 1_000;
        case 'm':
          return num * 60_000;
        case 'h':
          return num * 3_600_000;
        case 'd':
          return num * 86_400_000;
        case 'w':
          return num * 604_800_000;
      }
    }
  }
  return defaultMs;
}

/**
 * 解析默认超时时间：支持直接传入毫秒数（手工装配/测试覆盖）或注入 ConfigService 读取 HTTP_TIMEOUT_MS
 */
function resolveDefaultTimeoutMs(source?: number | ConfigService<EnvConfig, true>): number {
  if (typeof source === 'number') {
    return source;
  }
  if (source instanceof ConfigService) {
    return source.get('HTTP_TIMEOUT_MS', { infer: true }) ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * 生产级请求生命周期与取消协同拦截器 (RequestLifecycleInterceptor)
 *
 * 核心架构职责：
 * 1. 彻底淘汰手写 RxJS timeout() 强杀逻辑，方法与路由层超时与熔断 100% 移交 `@nestjs/resilience` 统一容灾中心；
 * 2. 协作取消中枢：创建并维护请求级 AbortController，挂载到 REQUEST_SIGNAL_SYMBOL 与 RequestContext (AsyncLocalStorage)；
 * 3. 客户端断连感知：监听 Fastify 底层 rawReq 的 'close' 事件，在浏览器或网关主动断连时联动触发 signal.abort()，
 *    避免下游数据库查询与微服务调用继续进行无意义的幽灵计算；
 * 4. 链路死线预算注入：计算当前请求的截止时刻注入 RequestContext，供下游微服务 / DeadlineInterceptor 自动获得全局墙钟死线；
 * 5. 智能流式长连接识别：识别 @BypassTimeout()、timeoutMs <= 0 以及 /realtime/stream 广播流，标记流式长连接并豁免超时预算。
 */
@Injectable()
export class RequestLifecycleInterceptor implements NestInterceptor {
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly reflector: Reflector,
    @Optional() defaultTimeoutSource?: number | ConfigService<EnvConfig, true>,
  ) {
    this.defaultTimeoutMs = resolveDefaultTimeoutMs(defaultTimeoutSource);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const targets = [context.getHandler(), context.getClass()];

    const isBypassed = this.reflector.getAllAndOverride<boolean | undefined>(BYPASS_TIMEOUT_KEY, targets) === true;

    const rawTimeout =
      this.reflector.getAllAndOverride<number | string | undefined>(TIMEOUT_METADATA_KEY, targets) ??
      this.reflector.getAllAndOverride<number | string | undefined>(LEGACY_TIMEOUT_METADATA_KEY, targets);
    const timeoutMs = parseDurationToMs(rawTimeout, this.defaultTimeoutMs);

    const req = context.switchToHttp().getRequest<FastifyRequest & { [REQUEST_SIGNAL_SYMBOL]?: AbortSignal }>();
    const controller = new AbortController();
    req[REQUEST_SIGNAL_SYMBOL] = controller.signal;

    // 智能探测是否为流式长连接 (SSE / WebSocket 广播流)
    const isStreamUrl = Boolean(req.raw?.url?.includes('/realtime/stream'));
    const shouldBypassTimeout = isBypassed || timeoutMs <= 0 || isStreamUrl;

    if (shouldBypassTimeout) {
      RequestContext.setStreaming(true);
      RequestContext.setDeadline(0, controller.signal);
    } else {
      RequestContext.setDeadline(timeoutMs, controller.signal);
    }

    const rawReq = req.raw;
    const onClose = () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('Client disconnected'));
      }
    };

    rawReq?.once('close', onClose);

    return next.handle().pipe(finalize(() => rawReq?.off?.('close', onClose)));
  }
}

/** 向下兼容别名导出 */
export { RequestLifecycleInterceptor as TimeoutInterceptor };

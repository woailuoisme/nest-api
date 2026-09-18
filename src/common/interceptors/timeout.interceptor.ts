import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  Optional,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { finalize, type Observable, throwError, timeout } from 'rxjs';
import { RequestContext } from '@/common/context';
import { REQUEST_SIGNAL_SYMBOL } from '@/common/decorators/req-signal.decorator';
import { BYPASS_TIMEOUT_KEY, TIMEOUT_METADATA_KEY } from '@/common/decorators/timeout.decorator';
import type { EnvConfig } from '@/config/env.validation';

/** 默认全局请求超时时间（毫秒） */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

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
 * 生产级双轨协作式超时拦截器 (Dual-Track Cooperative TimeoutInterceptor)
 *
 * 核心机制：
 * 1. 响应信封轨：通过 RxJS timeout 操作符拦截，超时时向前端抛出规范的 RequestTimeoutException（408）；
 * 2. 协作取消轨：内部创建并维护 AbortController，不仅通过 REQUEST_SIGNAL_SYMBOL 挂载到请求对象，
 *    更自动同步注入 RequestContext (AsyncLocalStorage)，全链路下游服务无需层层传递参数即可直接获得 signal；
 * 3. 截止时间与超时预算 (Deadline Budget)：将超时截止时刻计算后注入 RequestContext，
 *    供下游微服务调用与 @Resilient() 提前预检并自动缩紧剩余超时预算；
 * 4. 智能长连接豁免：识别 @BypassTimeout()、timeoutMs <= 0 以及 /realtime/stream 广播长连接，
 *    豁免应用层超时强杀，但依然维持底层连接断开时对 AbortSignal 的触发通知。
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
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

    const isBypassed =
      this.reflector.getAllAndOverride<boolean | undefined>(BYPASS_TIMEOUT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const rawTimeout = this.reflector.getAllAndOverride<number | undefined>(TIMEOUT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const timeoutMs = typeof rawTimeout === 'number' ? rawTimeout : this.defaultTimeoutMs;

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

    // 显式豁免超时或长连接场景：跳过 RxJS timeout 定时强杀，仅保留底层断连监听
    if (shouldBypassTimeout) {
      return next.handle().pipe(finalize(() => rawReq?.off?.('close', onClose)));
    }

    return next.handle().pipe(
      timeout({
        each: timeoutMs,
        with: () =>
          throwError(() => {
            if (!controller.signal.aborted) {
              controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
            }
            return new RequestTimeoutException(`Request timed out after ${timeoutMs}ms`);
          }),
      }),
      finalize(() => rawReq?.off?.('close', onClose)),
    );
  }
}

import { Injectable, RequestTimeoutException } from '@nestjs/common';
import type { HttpClientInterceptor, HttpHandler, HttpRequest } from '@nestjs/http-client';

import { RequestContext } from '@/common/context';

/**
 * 出站死线拦截器 (Outbound Deadline Interceptor)
 *
 * 把 `RequestContext` 里已经算好的请求预算接到出站 HTTP 调用上：
 * - 预算耗尽（`getRemainingMs() === 0`）时直接抛出，**不发起任何网络请求**；
 * - 预算有限时与 client 的静态 `timeout` 叠加，先到者生效；
 * - 无请求上下文（BullMQ Worker / 定时任务 / CLI）或流式端点（`Infinity`）时不做任何改写，
 *   由 client 自身的静态超时兜底。
 *
 * 该库的拦截器**每次尝试运行一次**，因此每轮都重新读取剩余预算 —— 得到的是墙钟死线，
 * 而不是「每次尝试各给 5 秒」。这正是重试关闭（`retry: false`）之外仍然需要它的原因：
 * 即使将来开启重试，整体耗时也不会突破请求预算。
 *
 * 与 `TimeoutInterceptor` 的分工：后者管理**请求生命周期**（含 SSE 豁免与客户端断连 abort），
 * 本拦截器管理**依赖调用**。同一个 handler 上不应出现第二处超时权威。
 */
@Injectable()
export class DeadlineInterceptor implements HttpClientInterceptor {
  async intercept(request: HttpRequest, next: HttpHandler): Promise<Response> {
    const remaining = RequestContext.getRemainingMs();

    if (remaining === 0) {
      throw new RequestTimeoutException('Request deadline exhausted before outbound call');
    }

    if (remaining !== undefined && Number.isFinite(remaining)) {
      request.signal = AbortSignal.any([request.signal, AbortSignal.timeout(remaining)]);
    }

    return next(request);
  }
}

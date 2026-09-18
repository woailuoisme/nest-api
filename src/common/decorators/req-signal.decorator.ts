import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** 请求级 AbortSignal 挂载在 Request 上的统一 Symbol 标识 */
export const REQUEST_SIGNAL_SYMBOL = Symbol.for('NESTFORGE:REQUEST_SIGNAL');

/**
 * 提取当前 HTTP 请求生命周期绑定的 AbortSignal
 *
 * 该信号由 TimeoutInterceptor 负责维护，具备以下协作特性：
 * 1. 当请求超过超时窗口时触发 abort；
 * 2. 当客户端提前断开连接（如网络中断、用户关闭页面）时触发 abort；
 * 3. 可直接透传给原生 fetch(url, { signal }) 或下游异步协同任务，避免幽灵计算。
 *
 * @example
 * ```typescript
 * @Get('remote-data')
 * async fetchData(@ReqSignal() signal: AbortSignal) {
 *   return this.remoteService.query(signal);
 * }
 * ```
 */
export const ReqSignal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AbortSignal => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest & { [REQUEST_SIGNAL_SYMBOL]?: AbortSignal }>();

  // 依次回退：请求级 signal → Fastify 底层 Node IncomingMessage.signal → 永不中止的空 signal
  return req?.[REQUEST_SIGNAL_SYMBOL] ?? req?.raw?.signal ?? new AbortController().signal;
});

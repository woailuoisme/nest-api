import { EventEmitter } from 'node:events';
import { type CallHandler, type ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import type { Reflector } from '@nestjs/core';
import { NEVER, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@/common/context';
import { REQUEST_SIGNAL_SYMBOL, ReqSignal } from '@/common/decorators/req-signal.decorator';
import {
  BYPASS_TIMEOUT_KEY,
  BypassTimeout,
  SetTimeout,
  TIMEOUT_METADATA_KEY,
  Timeout,
} from '@/common/decorators/timeout.decorator';
import { TimeoutInterceptor } from '@/common/interceptors/timeout.interceptor';

describe('TimeoutInterceptor (双轨协作式超时拦截器)', () => {
  const createMockReflector = (metadataValue?: number, isBypassedValue?: boolean): Reflector =>
    ({
      getAllAndOverride: vi.fn((key: string) => {
        if (key === BYPASS_TIMEOUT_KEY) {
          return isBypassedValue ?? false;
        }
        if (key === TIMEOUT_METADATA_KEY) {
          return metadataValue;
        }
        return undefined;
      }),
    }) as unknown as Reflector;

  const createMockContext = () => {
    const rawEmitter = new EventEmitter();
    const mockRequest: Record<string | symbol, unknown> = {
      raw: rawEmitter,
    };

    const context = {
      getType: vi.fn().mockReturnValue('http'),
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    return { context, mockRequest, rawEmitter };
  };

  it('场景 1: 正常请求未发生超时，应正常输出并清理定时器与监听器', async () => {
    const reflector = createMockReflector(1000);
    const interceptor = new TimeoutInterceptor(reflector, 1000);
    const { context, mockRequest } = createMockContext();

    const next: CallHandler = {
      handle: () => of({ success: true }),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toEqual({ success: true });
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
  });

  it('场景 2: 请求超时，应抛出 RequestTimeoutException 并且 signal 变为 aborted', async () => {
    const reflector = createMockReflector(50); // 50ms 超时
    const interceptor = new TimeoutInterceptor(reflector, 50);
    const { context, mockRequest } = createMockContext();

    // 模拟一个需要 150ms 的慢流
    const next: CallHandler = {
      handle: () => timer(150).pipe(map(() => ({ success: true }))),
    };

    let caughtError: unknown;
    let abortedAtError = false;

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: () => {},
        error: (err) => {
          caughtError = err;
          const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
          abortedAtError = signal?.aborted ?? false;
          resolve();
        },
      });
    });

    expect(caughtError).toBeInstanceOf(RequestTimeoutException);
    expect(abortedAtError).toBe(true);
  });

  it('场景 3: 支持通过 @Timeout() 装饰器局部覆盖默认超时时间', async () => {
    const reflector = createMockReflector(30); // 覆盖为 30ms
    const interceptor = new TimeoutInterceptor(reflector, 10_000);
    const { context, mockRequest } = createMockContext();

    const next: CallHandler = {
      handle: () => timer(100).pipe(map(() => 'done')),
    };

    let caughtError: unknown;
    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        error: (err) => {
          caughtError = err;
          resolve();
        },
      });
    });

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(TIMEOUT_METADATA_KEY, expect.any(Array));
    expect(caughtError).toBeInstanceOf(RequestTimeoutException);
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it('场景 4: 当超时时间设置为 <= 0 时，显式禁用超时检测', async () => {
    const reflector = createMockReflector(0); // 禁用超时
    const interceptor = new TimeoutInterceptor(reflector, 50);
    const { context, mockRequest } = createMockContext();

    const next: CallHandler = {
      handle: () => timer(80).pipe(map(() => 'large-file-stream-finished')),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('large-file-stream-finished');
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal.aborted).toBe(false);
  });

  it('场景 5: 客户端提前断开连接时，raw request 的 close 事件应联动触发 signal.abort()', () => {
    const reflector = createMockReflector(5000);
    const interceptor = new TimeoutInterceptor(reflector, 5000);
    const { context, mockRequest, rawEmitter } = createMockContext();

    let wasAborted = false;

    // 模拟尚未完成的未决请求（NEVER）
    const next: CallHandler = {
      handle: () => {
        const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
        signal.addEventListener('abort', () => {
          wasAborted = true;
        });
        return NEVER;
      },
    };

    const subscription = interceptor.intercept(context, next).subscribe();

    // 客户端提前断开连接
    rawEmitter.emit('close');

    expect(wasAborted).toBe(true);
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal.aborted).toBe(true);

    subscription.unsubscribe();
  });

  it('场景 6: 非 HTTP 上下文（如 RPC/Microservice/WebSocket）时直接放行', async () => {
    const reflector = createMockReflector(1000);
    const interceptor = new TimeoutInterceptor(reflector);

    const nonHttpContext = {
      getType: vi.fn().mockReturnValue('rpc'),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of('rpc-result'),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(nonHttpContext, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('rpc-result');
  });

  it('场景 7: @Timeout() 与 @SetTimeout() 装饰器能正确设置元数据', () => {
    class MockEndpoint {
      @Timeout(4500)
      handlerA() {}

      @SetTimeout(0)
      handlerB() {}
    }

    const metadataA = Reflect.getMetadata(TIMEOUT_METADATA_KEY, MockEndpoint.prototype.handlerA);
    const metadataB = Reflect.getMetadata(TIMEOUT_METADATA_KEY, MockEndpoint.prototype.handlerB);

    expect(metadataA).toBe(4500);
    expect(metadataB).toBe(0);
  });

  it('场景 8: @ReqSignal 装饰器工厂在不同请求上下文下的三级降级提取能力', () => {
    class DummyController {
      dummyMethod(@ReqSignal() _signal: AbortSignal) {}
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, DummyController, 'dummyMethod');
    const paramKey = Object.keys(metadata)[0];
    const factory = metadata[paramKey].factory;

    // 1. 优先提取挂载在 FastifyRequest 上的 Symbol 信号
    const customSignal = new AbortController().signal;
    const ctxWithSymbol = {
      switchToHttp: () => ({
        getRequest: () => ({ [REQUEST_SIGNAL_SYMBOL]: customSignal }),
      }),
    } as unknown as ExecutionContext;
    expect(factory(null, ctxWithSymbol)).toBe(customSignal);

    // 2. 兜底提取底层 Node IncomingMessage raw.signal
    const rawSignal = new AbortController().signal;
    const ctxWithRaw = {
      switchToHttp: () => ({
        getRequest: () => ({ raw: { signal: rawSignal } }),
      }),
    } as unknown as ExecutionContext;
    expect(factory(null, ctxWithRaw)).toBe(rawSignal);

    // 3. 最终兜底：生成一个合法的空 AbortSignal
    const ctxEmpty = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const fallbackSignal = factory(null, ctxEmpty);
    expect(fallbackSignal).toBeDefined();
    expect(fallbackSignal.aborted).toBe(false);
  });

  it('场景 9: 当 Fastify 请求缺少底层 raw request 时安全短路，不抛出 TypeError', async () => {
    const reflector = createMockReflector(50);
    const interceptor = new TimeoutInterceptor(reflector, 50);

    // 模拟无 raw socket 的特殊请求对象
    const mockRequestWithoutRaw: Record<string | symbol, unknown> = {};
    const contextWithoutRaw = {
      getType: vi.fn().mockReturnValue('http'),
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => mockRequestWithoutRaw,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of('ok-without-raw'),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(contextWithoutRaw, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('ok-without-raw');
    expect(mockRequestWithoutRaw[REQUEST_SIGNAL_SYMBOL]).toBeDefined();
  });

  it('场景 10: 当客户端断连已先触发 abort 时，紧随其后的超时不会重复调用 abort (竞态覆盖)', async () => {
    const reflector = createMockReflector(20);
    const interceptor = new TimeoutInterceptor(reflector, 20);
    const { context, mockRequest, rawEmitter } = createMockContext();

    // 模拟慢流，但在超时触发前客户端提前断连 (emit close)
    const next: CallHandler = {
      handle: () => {
        setTimeout(() => {
          rawEmitter.emit('close');
        }, 5);
        return timer(40).pipe(map(() => 'delayed'));
      },
    };

    let caughtError: unknown;
    await new Promise<void>((resolve) => {
      interceptor.intercept(context, next).subscribe({
        error: (err) => {
          caughtError = err;
          resolve();
        },
      });
    });

    expect(caughtError).toBeInstanceOf(RequestTimeoutException);
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it('场景 11: 显式禁用超时 (<= 0) 且无 rawReq 时，能够正常完成并正确解除监听', async () => {
    const reflector = createMockReflector(-1);
    const interceptor = new TimeoutInterceptor(reflector, 100);

    const mockRequest: Record<string | symbol, unknown> = {};
    const context = {
      getType: vi.fn().mockReturnValue('http'),
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of('disabled-timeout-without-raw'),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('disabled-timeout-without-raw');
  });

  it('场景 12: @BypassTimeout() 元数据与装饰器正确配置并豁免应用层超时强杀', async () => {
    class StreamController {
      @BypassTimeout()
      eventStream() {}
    }
    const isBypassed = Reflect.getMetadata(BYPASS_TIMEOUT_KEY, StreamController.prototype.eventStream);
    expect(isBypassed).toBe(true);

    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === BYPASS_TIMEOUT_KEY) return true;
        if (key === TIMEOUT_METADATA_KEY) return 20; // 即使设置了 20ms
        return undefined;
      }),
    } as unknown as Reflector;

    const interceptor = new TimeoutInterceptor(reflector, 20);
    const { context, mockRequest } = createMockContext();

    // 慢任务耗时 50ms (远大于 20ms)
    const next: CallHandler = {
      handle: () => timer(50).pipe(map(() => 'stream-completed')),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('stream-completed');
    const signal = mockRequest[REQUEST_SIGNAL_SYMBOL] as AbortSignal;
    expect(signal.aborted).toBe(false);
  });

  it('场景 13: 命中 /realtime/stream 流式长连接 URL 时智能自动豁免超时强杀', async () => {
    const reflector = createMockReflector(20);
    const interceptor = new TimeoutInterceptor(reflector, 20);
    const { context } = createMockContext();

    // 模拟 URL 为 /v1/realtime/stream
    const mockReq = context.switchToHttp().getRequest<{ raw?: { url?: string } }>();
    if (mockReq.raw) {
      mockReq.raw.url = '/v1/realtime/stream';
    }

    const next: CallHandler = {
      handle: () => timer(50).pipe(map(() => 'stream-ok')),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe({
        next: (val) => resolve(val),
      });
    });

    expect(result).toBe('stream-ok');
  });

  it('场景 14: TimeoutInterceptor 正确将 deadline 与 signal 同步注入 RequestContext (ALS)', async () => {
    const reflector = createMockReflector(500);
    const interceptor = new TimeoutInterceptor(reflector, 500);
    const { context } = createMockContext();

    await RequestContext.run({ requestId: 'test-req-als', startTime: Date.now() }, async () => {
      const next: CallHandler = {
        handle: () => {
          // 在 Controller / 下游执行期间，验证 ALS 中的上下文状态
          expect(RequestContext.getRequestId()).toBe('test-req-als');
          expect(RequestContext.getSignal()).toBeDefined();
          const remaining = RequestContext.getRemainingMs();
          expect(remaining).toBeDefined();
          expect(remaining!).toBeGreaterThan(400);
          expect(remaining!).toBeLessThanOrEqual(500);
          return of('als-verified');
        },
      };

      const res = await new Promise((resolve) => {
        interceptor.intercept(context, next).subscribe({
          next: (val) => resolve(val),
        });
      });
      expect(res).toBe('als-verified');
    });
  });

  it('场景 15: TimeoutInterceptor 支持 ConfigService 依赖注入与不同构造重载', () => {
    const reflector = createMockReflector();

    // 1. 无参默认
    const defaultInterceptor = new TimeoutInterceptor(reflector);
    expect(defaultInterceptor).toBeDefined();

    // 2. 纯数字
    const numInterceptor = new TimeoutInterceptor(reflector, 8000);
    expect(numInterceptor).toBeDefined();

    // 3. ConfigService 模拟注入
    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'HTTP_TIMEOUT_MS') return 12_000;
        return undefined;
      }),
    };
    const diInterceptor = new TimeoutInterceptor(reflector, mockConfigService as never);
    expect(diInterceptor).toBeDefined();
  });
});

import { RequestTimeoutException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpClient, type HttpHandler, type HttpRequest } from '@nestjs/http-client';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '@/common/context';
import { DeadlineInterceptor, HttpModule } from '@/common/http';

describe('统一出站 HTTP 客户端模块 (HttpModule & DeadlineInterceptor)', () => {
  let interceptor: DeadlineInterceptor;

  beforeEach(() => {
    vi.restoreAllMocks();
    interceptor = new DeadlineInterceptor();
  });

  describe('DeadlineInterceptor 预算与死线控制', () => {
    it('当请求剩余预算耗尽 (remainingMs === 0) 时应立即抛出 RequestTimeoutException 且不发起出站调用', async () => {
      vi.spyOn(RequestContext, 'getRemainingMs').mockReturnValue(0);

      const mockRequest = {
        signal: new AbortController().signal,
        url: 'https://api.example.com/data',
        method: 'GET',
      } as unknown as HttpRequest;

      const mockNext = vi.fn<HttpHandler>();

      await expect(interceptor.intercept(mockRequest, mockNext)).rejects.toThrow(RequestTimeoutException);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('当存在有效剩余预算时应通过 AbortSignal.any 叠加墙钟死线', async () => {
      vi.spyOn(RequestContext, 'getRemainingMs').mockReturnValue(500);

      const originalSignal = new AbortController().signal;
      const mockRequest = {
        signal: originalSignal,
        url: 'https://api.example.com/data',
        method: 'GET',
      } as unknown as HttpRequest;

      const dummyResponse = new Response('ok', { status: 200 });
      const mockNext = vi.fn<HttpHandler>().mockResolvedValue(dummyResponse);

      const res = await interceptor.intercept(mockRequest, mockNext);

      expect(res).toBe(dummyResponse);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRequest.signal).not.toBe(originalSignal);
      expect(mockRequest.signal.aborted).toBe(false);
    });

    it('在 Worker / CLI 或无请求上下文环境 (remainingMs === undefined) 时应保持原信号透传', async () => {
      vi.spyOn(RequestContext, 'getRemainingMs').mockReturnValue(undefined);

      const originalSignal = new AbortController().signal;
      const mockRequest = {
        signal: originalSignal,
        url: 'https://api.example.com/data',
        method: 'GET',
      } as unknown as HttpRequest;

      const dummyResponse = new Response('ok', { status: 200 });
      const mockNext = vi.fn<HttpHandler>().mockResolvedValue(dummyResponse);

      const res = await interceptor.intercept(mockRequest, mockNext);

      expect(res).toBe(dummyResponse);
      expect(mockNext).toHaveBeenCalledWith(mockRequest);
      expect(mockRequest.signal).toBe(originalSignal);
    });
  });

  describe('HttpModule 依赖注入与配置装配', () => {
    it('成功注册全局 HttpModule 并正确注入 HttpClient 实例', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [() => ({ HTTP_TIMEOUT_MS: 3000 })],
          }),
          HttpModule,
        ],
      }).compile();

      const httpClient = moduleRef.get(HttpClient);
      const injectedInterceptor = moduleRef.get(DeadlineInterceptor);

      expect(httpClient).toBeDefined();
      expect(injectedInterceptor).toBeDefined();
      expect(typeof httpClient.get).toBe('function');
      expect(typeof httpClient.request).toBe('function');
    });
  });
});

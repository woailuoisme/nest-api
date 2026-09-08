import {
  BadRequestException,
  ConflictException,
  type ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEMPOTENT_KEY, Idempotent } from '@/common/idempotency/idempotency.decorator';
import { IdempotencyInterceptor } from '@/common/idempotency/idempotency.interceptor';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';

describe('Idempotency Module Unit Tests', () => {
  describe('IdempotencyService', () => {
    let service: IdempotencyService;
    let mockDb: any;

    beforeEach(() => {
      mockDb = {
        insert: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
      };
      service = new IdempotencyService(mockDb);
    });

    it('computePayloadHash 应稳定生成 SHA-256 64位十六进制哈希', () => {
      const hash1 = service.computePayloadHash({ foo: 'bar', num: 123 });
      const hash2 = service.computePayloadHash({ foo: 'bar', num: 123 });
      const hash3 = service.computePayloadHash({ foo: 'baz' });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(hash3);
    });

    it('首次请求应成功原子插入并返回 recordId', async () => {
      const returningMock = vi.fn().mockResolvedValue([{ id: 101 }]);
      const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
      mockDb.insert.mockReturnValue({ values: valuesMock });

      const res = await service.acquire({
        key: 'test-key-1',
        requestPath: '/v1/users',
        requestMethod: 'POST',
        actorType: 'user',
        userId: 'u-1',
        payloadHash: 'hash-abc',
      });

      expect(res).toEqual({ acquired: true, recordId: 101 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('发生唯一键冲突且 Payload 篡改时应抛出 422 UnprocessableEntityException (API.md 3.3.3)', async () => {
      mockDb.insert.mockImplementation(() => {
        const err: any = new Error('duplicate key');
        err.code = '23505';
        throw err;
      });

      const whereMock = vi.fn().mockResolvedValue([
        {
          id: 101,
          key: 'test-key-1',
          requestParamsHash: 'different-hash',
          status: 'completed',
          expiresAt: new Date(Date.now() + 100000),
        },
      ]);
      mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) });

      await expect(
        service.acquire({
          key: 'test-key-1',
          requestPath: '/v1/users',
          requestMethod: 'POST',
          actorType: 'user',
          userId: 'u-1',
          payloadHash: 'new-tampered-hash',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('发生唯一键冲突且前序请求正在处理中时应抛出 409 ConflictException 提示退避 (API.md 3.3.4)', async () => {
      mockDb.insert.mockImplementation(() => {
        const err: any = new Error('duplicate key');
        err.code = '23505';
        throw err;
      });

      const whereMock = vi.fn().mockResolvedValue([
        {
          id: 101,
          key: 'test-key-1',
          requestParamsHash: 'same-hash',
          status: 'started',
          expiresAt: new Date(Date.now() + 100000),
        },
      ]);
      mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) });

      await expect(
        service.acquire({
          key: 'test-key-1',
          requestPath: '/v1/users',
          requestMethod: 'POST',
          actorType: 'user',
          userId: 'u-1',
          payloadHash: 'same-hash',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('发生唯一键冲突且前序请求已完成时应返回已缓存的响应并告知回放', async () => {
      mockDb.insert.mockImplementation(() => {
        const err: any = new Error('duplicate key');
        err.code = '23505';
        throw err;
      });

      const whereMock = vi.fn().mockResolvedValue([
        {
          id: 101,
          key: 'test-key-1',
          requestParamsHash: 'same-hash',
          status: 'completed',
          responseStatusCode: 201,
          responseBody: { id: 'u-1', name: 'Alice' },
          responseHeaders: { 'x-custom': 'val' },
          expiresAt: new Date(Date.now() + 100000),
        },
      ]);
      mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) });

      const res = await service.acquire({
        key: 'test-key-1',
        requestPath: '/v1/users',
        requestMethod: 'POST',
        actorType: 'user',
        userId: 'u-1',
        payloadHash: 'same-hash',
      });

      expect(res).toEqual({
        acquired: false,
        cached: {
          statusCode: 201,
          body: { id: 'u-1', name: 'Alice' },
          headers: { 'x-custom': 'val' },
        },
      });
    });
  });

  describe('IdempotencyInterceptor', () => {
    let interceptor: IdempotencyInterceptor;
    let mockService: any;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      mockService = {
        computePayloadHash: vi.fn().mockReturnValue('hash123'),
        acquire: vi.fn(),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };
      interceptor = new IdempotencyInterceptor(reflector, mockService);
    });

    const createMockContext = (method: string, headers: Record<string, string> = {}) => {
      const resHeaders: Record<string, string> = {};
      let currentStatusCode = 200;

      const req = {
        method,
        url: '/v1/users',
        headers,
        body: { name: 'Bob' },
        user: { id: 'usr-1' },
      };

      const res = {
        get statusCode() {
          return currentStatusCode;
        },
        status: (code: number) => {
          currentStatusCode = code;
          return res;
        },
        header: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
          return res;
        },
      };

      return {
        context: {
          getHandler: () => ({}),
          getClass: () => ({}),
          switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
          }),
        } as unknown as ExecutionContext,
        req,
        res,
        resHeaders,
      };
    };

    it('GET 请求应直接放行不触发幂等性逻辑', async () => {
      const { context } = createMockContext('GET');
      const next = { handle: () => of({ list: [] }) };

      const result = await new Promise((resolve) => {
        interceptor.intercept(context, next).then((obs) => obs.subscribe(resolve));
      });

      expect(result).toEqual({ list: [] });
      expect(mockService.acquire).not.toHaveBeenCalled();
    });

    it('标注了 required: true 且缺少 Idempotency-Key 请求头时应抛出 400 BadRequestException', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ required: true });
      const { context } = createMockContext('POST', {});
      const next = { handle: () => of({ ok: true }) };

      await expect(interceptor.intercept(context, next)).rejects.toThrow(BadRequestException);
    });

    it('未提供 Header 且未标注 required 时应平滑放行', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', {});
      const next = { handle: () => of({ ok: true }) };

      const result = await new Promise((resolve) => {
        interceptor.intercept(context, next).then((obs) => obs.subscribe(resolve));
      });

      expect(result).toEqual({ ok: true });
      expect(mockService.acquire).not.toHaveBeenCalled();
    });

    it('提供 Idempotency-Key 且命中缓存时应短路处理器直接回放响应并写入 X-Idempotency-Replayed', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, resHeaders } = createMockContext('POST', { 'idempotency-key': 'key-999' });

      mockService.acquire.mockResolvedValue({
        acquired: false,
        cached: {
          statusCode: 201,
          body: { id: 'u-saved', name: 'Cached' },
          headers: { 'x-test': 'ok' },
        },
      });

      const handlerSpy = vi.fn();
      const next = { handle: () => of(handlerSpy()) };

      const result = await new Promise((resolve) => {
        interceptor.intercept(context, next).then((obs) => obs.subscribe(resolve));
      });

      expect(result).toEqual({ id: 'u-saved', name: 'Cached' });
      expect(handlerSpy).not.toHaveBeenCalled(); // 业务 Handler 完全被短路保护！
      expect(resHeaders['x-idempotency-replayed']).toBe('true');
      expect(resHeaders['x-test']).toBe('ok');
    });

    it('提供 Idempotency-Key 且首次执行时应在完成时调用 complete 保存响应', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', { 'idempotency-key': 'key-new' });

      mockService.acquire.mockResolvedValue({
        acquired: true,
        recordId: 888,
      });

      const next = { handle: () => of({ id: 'new-user', name: 'New' }) };

      const result = await new Promise((resolve) => {
        interceptor.intercept(context, next).then((obs) => obs.subscribe(resolve));
      });

      expect(result).toEqual({ id: 'new-user', name: 'New' });
      expect(mockService.complete).toHaveBeenCalledWith(888, 200, { id: 'new-user', name: 'New' });
    });
  });
});

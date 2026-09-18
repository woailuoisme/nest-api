import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BYPASS_TRANSFORM_KEY } from '@/common/decorators/response.decorator';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';

describe('TransformInterceptor', () => {
  it('should return bare JSON entity for single object response', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === BYPASS_TRANSFORM_KEY) return false;
      return null;
    });

    const interceptor = new TransformInterceptor(reflector);
    const mockContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler = {
      handle: () => of({ id: 1, name: 'Test' }),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe(resolve);
    });

    expect(result).toEqual({ id: 1, name: 'Test' });
  });

  it('should unwrap paginated responses into root-level { items, meta } format', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === BYPASS_TRANSFORM_KEY) return false;
      return null;
    });

    const interceptor = new TransformInterceptor(reflector);
    const mockContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;

    const paginatedPayload = {
      items: [{ id: 1, name: 'Test' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };

    const mockCallHandler = {
      handle: () => of(paginatedPayload),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe(resolve);
    });

    expect(result).toEqual({
      items: [{ id: 1, name: 'Test' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it('should bypass transformation when BypassTransform is set', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === BYPASS_TRANSFORM_KEY) return true;
      return null;
    });

    const interceptor = new TransformInterceptor(reflector);
    const mockContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;

    const rawData = 'raw string content';
    const mockCallHandler = {
      handle: () => of(rawData),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe(resolve);
    });

    expect(result).toBe(rawData);
  });

  it('should pass through raw value without wrapping when status code is 204 No Content', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === BYPASS_TRANSFORM_KEY) return false;
      return null;
    });

    const interceptor = new TransformInterceptor(reflector);
    const mockContext = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 204 }),
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler = {
      handle: () => of(undefined),
    };

    const result = await new Promise((resolve) => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe(resolve);
    });

    expect(result).toBeUndefined();
  });
});

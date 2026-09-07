import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SseAuthGuard } from '@/realtime/guards/sse-auth.guard';

describe('SseAuthGuard', () => {
  let guard: SseAuthGuard;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwtService = {
      verifyAsync: vi.fn(),
    };
    configService = {
      get: vi.fn().mockReturnValue('mock-access-secret'),
    };

    guard = new SseAuthGuard(jwtService as unknown as JwtService, configService as unknown as ConfigService<any, true>);
  });

  const createMockContext = (query?: Record<string, unknown>, headers?: Record<string, string>) => {
    const request: any = {
      query: query ?? {},
      headers: headers ?? {},
      user: undefined,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      request,
    };
  };

  it('优先从 query.token 中提取 JWT 并完成验证挂载 user', async () => {
    const { switchToHttp, request } = createMockContext({ token: 'jwt-from-query' });
    jwtService.verifyAsync.mockResolvedValue({
      sub: '42',
      email: 'sse-user@example.com',
      role: 'USER',
    });

    const result = await guard.canActivate({ switchToHttp } as any);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt-from-query', { secret: 'mock-access-secret' });
    expect(request.user).toEqual({
      id: 42,
      email: 'sse-user@example.com',
      role: 'USER',
    });
  });

  it('当 query.token 不存在时应降级从 Authorization Header 中提取 Bearer Token', async () => {
    const { switchToHttp, request } = createMockContext({}, { authorization: 'Bearer jwt-from-header' });
    jwtService.verifyAsync.mockResolvedValue({
      sub: '10',
      email: 'header-user@example.com',
      role: 'ADMIN',
    });

    const result = await guard.canActivate({ switchToHttp } as any);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt-from-header', { secret: 'mock-access-secret' });
    expect(request.user).toEqual({
      id: 10,
      email: 'header-user@example.com',
      role: 'ADMIN',
    });
  });

  it('未提供 token 时应抛出 UnauthorizedException', async () => {
    const { switchToHttp } = createMockContext({}, {});

    await expect(guard.canActivate({ switchToHttp } as any)).rejects.toThrow(
      'Authentication token is required to establish SSE stream',
    );
  });

  it('Token 非法或过期时应抛出 UnauthorizedException', async () => {
    const { switchToHttp } = createMockContext({ token: 'expired-or-invalid' });
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate({ switchToHttp } as any)).rejects.toThrow('Invalid or expired authentication token');
  });
});

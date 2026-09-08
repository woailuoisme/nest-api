import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/common/auth/better-auth';
import { Role } from '@/common/constants/roles';
import { SseAuthGuard } from '@/realtime/guards/sse-auth.guard';

vi.mock('@/common/auth/better-auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

describe('SseAuthGuard', () => {
  let guard: SseAuthGuard;

  beforeEach(() => {
    guard = new SseAuthGuard();
    vi.mocked(auth.api.getSession).mockReset();
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

  it('优先从 query.token 中提取 Token 并完成 Better Auth 会话验证挂载 user', async () => {
    const { switchToHttp, request } = createMockContext({ token: 'query-token' });
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'sess-1' } as any,
      user: {
        id: 'user-42',
        email: 'sse-user@example.com',
        name: 'SSE User',
        role: Role.USER,
      } as any,
    });

    const result = await guard.canActivate({ switchToHttp } as any);

    expect(result).toBe(true);
    expect(auth.api.getSession).toHaveBeenCalled();
    expect(request.user).toEqual({
      id: 'user-42',
      email: 'sse-user@example.com',
      name: 'SSE User',
      role: Role.USER,
      image: undefined,
    });
  });

  it('当 query.token 不存在时应从 Authorization Header 中提取 Bearer Token 验证', async () => {
    const { switchToHttp, request } = createMockContext({}, { authorization: 'Bearer header-token' });
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'sess-2' } as any,
      user: {
        id: 'user-10',
        email: 'header-user@example.com',
        name: 'Admin User',
        role: Role.ADMIN,
      } as any,
    });

    const result = await guard.canActivate({ switchToHttp } as any);

    expect(result).toBe(true);
    expect(auth.api.getSession).toHaveBeenCalled();
    expect(request.user).toEqual({
      id: 'user-10',
      email: 'header-user@example.com',
      name: 'Admin User',
      role: Role.ADMIN,
      image: undefined,
    });
  });

  it('未提供 token 时应抛出 UnauthorizedException', async () => {
    const { switchToHttp } = createMockContext({}, {});
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    await expect(guard.canActivate({ switchToHttp } as any)).rejects.toThrow(
      'Authentication token is required to establish SSE stream',
    );
  });

  it('被封禁用户试图建立连接应抛出 UnauthorizedException 拦截', async () => {
    const { switchToHttp } = createMockContext({ token: 'banned-token' });
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'sess-banned' } as any,
      user: {
        id: 'user-banned',
        email: 'banned@example.com',
        name: 'Banned User',
        role: Role.USER,
        banned: true,
        banReason: 'Account suspended for policy violation',
      } as any,
    });

    await expect(guard.canActivate({ switchToHttp } as any)).rejects.toThrow('Account suspended for policy violation');
  });

  it('Token 非法或过期时应抛出 UnauthorizedException', async () => {
    const { switchToHttp } = createMockContext({ token: 'expired-or-invalid' });
    vi.mocked(auth.api.getSession).mockRejectedValue(new Error('session expired'));

    await expect(guard.canActivate({ switchToHttp } as any)).rejects.toThrow('Invalid or expired authentication token');
  });
});

import type { ExecutionContext } from '@nestjs/common';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APIError } from 'better-auth/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/common/auth/better-auth';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';

/**
 * 会话校验 spy 的最小契约：Better Auth 的 `auth.api.getSession` 返回类型极复杂，
 * 此处只声明用例需要的三个能力，避免与第三方类型签名缠斗。
 */
type SessionSpy = {
  mockResolvedValue: (value: unknown) => void;
  mockRejectedValue: (error: unknown) => void;
  mock: { calls: unknown[][] };
};

const SESSION_OK = {
  user: { id: 'u1', email: 'zhangsan@example.com', name: '张三', role: 'user', image: null },
  session: { token: 'session-token' },
};

describe('BetterAuthGuard', () => {
  let guard: BetterAuthGuard;
  let reflector: Reflector;
  let getSession: SessionSpy;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new BetterAuthGuard(reflector);
    getSession = vi.spyOn(auth.api, 'getSession') as unknown as SessionSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 构造携带指定请求头/查询串的 mock ExecutionContext，并按需模拟 @Public() 元数据 */
  function createMockContext(
    options: { isPublic?: boolean; headers?: Record<string, string>; query?: Record<string, unknown> } = {},
  ): { context: ExecutionContext; request: Record<string, unknown> } {
    const request: Record<string, unknown> = {
      headers: options.headers ?? { cookie: 'better-auth.session_token=stub' },
      query: options.query ?? {},
    };

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(((key: string) =>
      key === IS_PUBLIC_KEY ? options.isPublic : undefined) as never);

    const context = {
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  describe('@Public() 白名单', () => {
    it('公开路由直接放行且不触达会话校验', async () => {
      const { context } = createMockContext({ isPublic: true });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(getSession.mock.calls).toHaveLength(0);
    });
  });

  describe('会话校验', () => {
    it('无会话时抛出 401 UnauthorizedException', async () => {
      const { context } = createMockContext();
      getSession.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('有效会话应注入 request.user / request.session 并放行', async () => {
      const { context, request } = createMockContext();
      getSession.mockResolvedValue(SESSION_OK);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toMatchObject({ id: 'u1', role: 'user' });
      expect(request.session).toEqual(SESSION_OK.session);
    });

    it('账号被封禁时抛出 401 并携带封禁原因', async () => {
      const { context } = createMockContext();
      getSession.mockResolvedValue({ user: { ...SESSION_OK.user, banned: true, banReason: '违规账号' }, session: {} });

      await expect(guard.canActivate(context)).rejects.toThrow('违规账号');
    });

    it('支持 ?token= 查询参数转换为 Bearer 头（EventSource / 移动端场景）', async () => {
      const { context } = createMockContext({ headers: {}, query: { token: 'query-token' } });
      getSession.mockResolvedValue(SESSION_OK);

      await guard.canActivate(context);

      const passed = getSession.mock.calls[0]?.[0] as { headers: Headers };
      expect(passed.headers.get('authorization')).toBe('Bearer query-token');
    });
  });

  describe('失败语义分流', () => {
    it('Better Auth 返回 401 APIError（会话失效/被并发撤销）应保持 401，不得降级为 503', async () => {
      const { context } = createMockContext();
      getSession.mockRejectedValue(
        APIError.from('UNAUTHORIZED', { code: 'UNAUTHORIZED', message: 'Failed to get session' }),
      );

      const error: unknown = await guard.canActivate(context).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getStatus()).toBe(401);
    });

    it('Better Auth 返回 5xx APIError 应映射为 503', async () => {
      const { context } = createMockContext();
      getSession.mockRejectedValue(
        APIError.from('INTERNAL_SERVER_ERROR', { code: 'INTERNAL_SERVER_ERROR', message: 'database unavailable' }),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('网络/未知异常应映射为 503（系统故障不得伪装成登录过期）', async () => {
      const { context } = createMockContext();
      getSession.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});

import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { auth } from '@/common/auth/better-auth';
import type { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

/**
 * 全局 Better Auth 会话守卫 (BetterAuthGuard)
 *
 * 1. 检查 @Public() 装饰器，白名单路由直接放行；
 * 2. 从 HTTP-Only Cookie 或 Authorization: Bearer <token> 请求头中提取凭证；
 * 3. 通过 Better Auth 会话验证 API (auth.api.getSession) 校验；
 * 4. 账号封禁校验 (user.banned)；
 * 5. 将会话与用户信息注入到 Fastify request.user 与 request.session。
 */
@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const headers = fromNodeHeaders(request.headers);

    // 支持 Query String ?token=<session_token> 提取并转换为 Bearer 头（适配 EventSource / 某些移动端场景）
    const query = request.query as Record<string, unknown> | undefined;
    if (query?.token && typeof query.token === 'string' && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${query.token.trim()}`);
    }

    try {
      const sessionData = await auth.api.getSession({ headers });

      if (!sessionData?.user) {
        throw new UnauthorizedException('Authentication required');
      }

      const user = sessionData.user as typeof sessionData.user & {
        banned?: boolean | null;
        banReason?: string | null;
        role?: Role | null;
      };

      if (user.banned) {
        throw new UnauthorizedException(user.banReason || 'Account suspended');
      }

      const currentUser: CurrentUserPayload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: (user.role as Role) || ('user' as Role),
        image: user.image,
      };

      (request as unknown as { user: CurrentUserPayload }).user = currentUser;
      (request as unknown as { session: typeof sessionData.session }).session = sessionData.session;

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}

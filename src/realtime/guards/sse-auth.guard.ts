import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { auth } from '@/common/auth/better-auth';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

/**
 * 专为 Server-Sent Events (SSE) 长连接设计的双通道鉴权守卫：
 * 1. 优先从请求头（Cookie、Authorization: Bearer）提取凭证；
 * 2. 兼容提取 Query 参数 `?token=<token>` 并转化为 Bearer 头；
 * 3. 通过 Better Auth 会话接口验证会话有效性。
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const headers = fromNodeHeaders(request.headers);

    const query = request.query as Record<string, unknown> | undefined;
    if (query?.token && typeof query.token === 'string' && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${query.token.trim()}`);
    }

    try {
      const sessionData = await auth.api.getSession({ headers });

      if (!sessionData?.user) {
        throw new UnauthorizedException('Authentication token is required to establish SSE stream');
      }

      const user = sessionData.user as typeof sessionData.user & {
        banned?: boolean | null;
        banReason?: string | null;
        role?: Role | null;
      };

      if (user.banned) {
        throw new UnauthorizedException(user.banReason || 'Account suspended');
      }

      (request as FastifyRequest & { user: CurrentUserPayload }).user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: (user.role as Role) || Role.USER,
        image: user.image,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }
}

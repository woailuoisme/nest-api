import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { auth } from '@/common/auth/better-auth';
import type { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

/** 鉴权载荷挂载点：由本守卫写入 request，供 @CurrentUser / @Session 装饰器读取 */
type AuthenticatedRequest = FastifyRequest & {
  user?: CurrentUserPayload;
  session?: unknown;
};

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
  #logger = new Logger(BetterAuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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

      request.user = currentUser;
      request.session = sessionData.session;

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }

      // Better Auth 的 APIError 自带语义化 status（UNAUTHORIZED=401 / FORBIDDEN=403 / INTERNAL_SERVER_ERROR=500），
      // 4xx 属「凭证/会话」问题（如会话刷新期间被并发删除），必须保持 4xx 语义：
      // 压成 503 会让客户端把「会话失效」当 5xx 重试，也会让告警把用户态问题误报为系统故障
      if (isAPIError(err) && err.statusCode < 500) {
        this.#logger.warn(`会话校验被拒（认证后端返回 ${err.statusCode}）: ${err.message}`);
        throw new UnauthorizedException(err.message || 'Invalid or expired session');
      }

      // 仅真正的会话后端故障（网络超时 / Better Auth 5xx / 未知异常）降级为 503：
      // 统一压成 401 会把系统故障伪装成登录过期，掩盖真实原因 → 记录后以 503 上抛，交由调用方与告警区分处理
      this.#logger.error(
        `会话校验失败（认证后端异常）: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException('Authentication backend unavailable');
    }
  }
}

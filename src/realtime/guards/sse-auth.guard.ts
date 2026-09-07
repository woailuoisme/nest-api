import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from '@/api/client/auth/strategies/jwt.strategy';
import type { EnvConfig } from '@/config/env.validation';

/**
 * 专为 Server-Sent Events (SSE) 长连接设计的双通道鉴权守卫：
 * 1. 优先提取 Query 参数 `?token=<jwt>`（适配浏览器原生 EventSource 无法自定义请求头的限制）
 * 2. 降级提取标准请求头 `Authorization: Bearer <jwt>`
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is required to establish SSE stream');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
      });

      // 将解码后的用户信息挂载到 request.user
      (request as FastifyRequest & { user: unknown }).user = {
        id: Number(payload.sub),
        email: payload.email,
        role: payload.role,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }

  private extractToken(request: FastifyRequest): string | null {
    const query = request.query as Record<string, unknown> | undefined;
    if (query && typeof query.token === 'string' && query.token.trim().length > 0) {
      return query.token.trim();
    }

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    return null;
  }
}

import { Injectable } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { auth } from '@/common/auth/better-auth';

/**
 * 认证门面服务 — 向其他 NestJS 业务模块提供类型安全的 Better Auth 客户端与 API 调用入口
 */
@Injectable()
export class AuthService {
  readonly auth = auth;
  readonly api = auth.api;

  /**
   * 将 Better Auth Web Response 管道流式或结构化回写至 FastifyReply
   */
  async pipeResponse(response: Response, reply: FastifyReply): Promise<void> {
    reply.status(response.status);
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });

    const responseText = await response.text();
    if (!responseText) {
      reply.send();
      return;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        reply.send(JSON.parse(responseText));
        return;
      } catch {
        // 非法 JSON 降级发送原始文本
      }
    }

    reply.send(responseText);
  }
}

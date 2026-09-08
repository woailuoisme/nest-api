/**
 * AuthController 单元测试（Better Auth HTTP 桥接）
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '@/api/client/auth/auth.controller';
import { AuthService } from '@/api/client/auth/auth.service';
import { auth } from '@/common/auth/better-auth';

describe('AuthController', () => {
  let authController: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService],
    }).compile();

    authController = module.get(AuthController);
  });

  describe('handleAuth()', () => {
    it('应将 Fastify 请求转发给 auth.handler 并回写响应', async () => {
      const mockReq = {
        protocol: 'http',
        headers: { host: 'localhost:4300' },
        raw: { url: '/v1/auth/session' },
        url: '/v1/auth/session',
        method: 'GET',
      } as any;

      const replyHeaders = new Map<string, string>();
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        header: vi.fn((k: string, v: string) => replyHeaders.set(k, v)),
        send: vi.fn(),
      } as any;

      const mockResponse = new Response(JSON.stringify({ session: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(auth, 'handler').mockResolvedValue(mockResponse);

      await authController.handleAuth(mockReq, mockReply);

      expect(auth.handler).toHaveBeenCalled();
      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({ session: null });
    });
  });
});

/**
 * JwtAuthGuard 单元测试
 *
 * 覆盖：公开路由绕过、JWT 验证委托
 */
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '@/api/client/auth/auth.guard';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

describe('JwtAuthGuard', () => {
  /** 创建 mock ExecutionContext */
  function createMockContext(handlerMetadata?: Record<string, unknown>, classMetadata?: Record<string, unknown>) {
    return {
      getHandler: () => handlerMetadata ?? {},
      getClass: () => classMetadata ?? {},
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer test-token' } }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  describe('canActivate() — 公开路由绕过', () => {
    it('IS_PUBLIC_KEY 为 true 时应返回 true（跳过 JWT 验证）', () => {
      const reflector = new Reflector();
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const guard = new JwtAuthGuard(reflector);
      const context = createMockContext();

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('IS_PUBLIC_KEY 为 falsy 时应调用父类 canActivate（JWT 验证）', async () => {
      const reflector = new Reflector();
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const guard = new JwtAuthGuard(reflector);
      const context = createMockContext();

      // 父类 canActivate 会尝试验证 JWT/Admin-JWT，由于没有真实策略注册会 reject
      await expect(guard.canActivate(context)).rejects.toThrow(/Unknown authentication strategy/);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('不同路由的 IS_PUBLIC_KEY 应独立判断', async () => {
      const reflector = new Reflector();
      const guard = new JwtAuthGuard(reflector);

      // 第一次调用：公开路由 — 直接返回 true
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
      expect(guard.canActivate(createMockContext({ isPublic: true }))).toBe(true);

      // 第二次调用：受保护路由 — 父类会 reject
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(false);
      await expect(guard.canActivate(createMockContext({ isPublic: false }))).rejects.toThrow(
        /Unknown authentication strategy/,
      );
    });
  });
});

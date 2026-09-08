/**
 * AdminPrefixGuard 单元测试
 *
 * 覆盖：非 /admin 路径直通、@Public() 放行、/admin 前缀要求合法管理角色、query 剥离、/admin-xxx 不误伤、无 user 默认拒绝
 */
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRole, Role } from '@/common/constants/roles';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { AdminPrefixGuard } from '@/common/guards/admin-prefix.guard';

describe('AdminPrefixGuard', () => {
  let guard: AdminPrefixGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new AdminPrefixGuard(reflector);
  });

  const createContext = (url: string, role?: string, isPublic = false): ExecutionContext => {
    const handler = vi.fn();
    const targetClass = vi.fn();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return isPublic;
      return undefined;
    });

    return {
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToHttp: () => ({
        getRequest: () => ({ url, user: role ? { role } : undefined }),
      }),
    } as unknown as ExecutionContext;
  };

  describe('非 /admin 路径 — 直通', () => {
    it('普通业务路径无论角色与登录态如何均放行', () => {
      expect(guard.canActivate(createContext('/users/me'))).toBe(true);
      expect(guard.canActivate(createContext('/users/me', Role.USER))).toBe(true);
      expect(guard.canActivate(createContext('/health'))).toBe(true);
    });

    it('形似前缀的路径（/admin-panel）不误伤，无登录态也放行', () => {
      expect(guard.canActivate(createContext('/admin-panel'))).toBe(true);
      expect(guard.canActivate(createContext('/adminx'))).toBe(true);
    });
  });

  describe('@Public() — 公开后台路径', () => {
    it('标记为 @Public 的 /admin/auth/login 应直接放行', () => {
      expect(guard.canActivate(createContext('/admin/auth/login', undefined, true))).toBe(true);
    });
  });

  describe('/admin 前缀 — 强制管理员角色', () => {
    it('SUPER_ADMIN / ADMIN / OPERATOR 访问 /admin 下任意路径放行', () => {
      expect(guard.canActivate(createContext('/admin/users', AdminRole.SUPER_ADMIN))).toBe(true);
      expect(guard.canActivate(createContext('/admin/dashboard/metrics', AdminRole.ADMIN))).toBe(true);
      expect(guard.canActivate(createContext('/admin/admins', AdminRole.OPERATOR))).toBe(true);
      expect(guard.canActivate(createContext('/admin', Role.ADMIN))).toBe(true);
    });

    it('非管理员角色（USER / 其他）一律拒绝', () => {
      expect(guard.canActivate(createContext('/admin/users', Role.USER))).toBe(false);
      expect(guard.canActivate(createContext('/admin/dashboard/metrics', 'GUEST' as any))).toBe(false);
    });

    it('未登录（无 user）一律拒绝', () => {
      expect(guard.canActivate(createContext('/admin/users'))).toBe(false);
      expect(guard.canActivate(createContext('/admin'))).toBe(false);
    });

    it('携带 query 的路径应先剥离 query 再匹配前缀', () => {
      expect(guard.canActivate(createContext('/admin/users?page=1', AdminRole.ADMIN))).toBe(true);
      expect(guard.canActivate(createContext('/admin/users?page=1', Role.USER))).toBe(false);
    });

    it('携带 URI 版本号（/v1/admin/*, /v2/admin/*）时正确拦截并校验角色', () => {
      expect(guard.canActivate(createContext('/v1/admin/users', AdminRole.ADMIN))).toBe(true);
      expect(guard.canActivate(createContext('/v1/admin/users', Role.USER))).toBe(false);
      expect(guard.canActivate(createContext('/v1/admin/users'))).toBe(false);
      expect(guard.canActivate(createContext('/v1/admin/auth/login', undefined, true))).toBe(true);
      expect(guard.canActivate(createContext('/v2/admin/dashboard/metrics', AdminRole.SUPER_ADMIN))).toBe(true);
    });
  });
});

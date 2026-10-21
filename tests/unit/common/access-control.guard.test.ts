import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CasbinService } from '@/common/auth/casbin/casbin.service';
import { Permission } from '@/common/constants/permissions';
import { Role } from '@/common/constants/roles';
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { AccessControlGuard } from '@/common/guards/access-control.guard';

describe('AccessControlGuard', () => {
  let guard: AccessControlGuard;
  let reflector: Reflector;

  beforeAll(async () => {
    const casbin = new CasbinService();
    await casbin.onModuleInit();
    reflector = new Reflector();
    guard = new AccessControlGuard(reflector, casbin);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const createMockContext = (user?: { role?: Role }) => {
    const handler = vi.fn();
    const targetClass = vi.fn();
    return {
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  describe('@Public() — 公开路由', () => {
    it('标记 @Public() 的路由应直接放行，无需校验角色与权限', async () => {
      const context = createMockContext(undefined);
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('无约束路由', () => {
    it('未标记 @Roles 与 @Permissions 的路由应直接放行', async () => {
      const context = createMockContext({ role: Role.USER });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('@Roles() — 角色级约束', () => {
    it('ADMIN 与 SUPER_ADMIN 用户在任意角色限制下均应直接放行', async () => {
      const adminCtx = createMockContext({ role: Role.ADMIN });
      const superAdminCtx = createMockContext({ role: Role.SUPER_ADMIN });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return [Role.OPERATOR];
        return undefined;
      });

      await expect(guard.canActivate(adminCtx)).resolves.toBe(true);
      await expect(guard.canActivate(superAdminCtx)).resolves.toBe(true);
    });

    it('拥有允许角色的用户应成功放行', async () => {
      const context = createMockContext({ role: Role.OPERATOR });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return [Role.OPERATOR, Role.ADMIN];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('不具备允许角色的用户应被拦截', async () => {
      const context = createMockContext({ role: Role.USER });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return [Role.OPERATOR, Role.ADMIN];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });

    it('未携带有效 user 对象的请求应被拦截', async () => {
      const context = createMockContext(undefined);
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === ROLES_KEY) return [Role.USER];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });
  });

  describe('@Permissions() — 细粒度权限约束（Casbin 判定）', () => {
    it('ADMIN 用户在任意权限要求下应放行', async () => {
      const context = createMockContext({ role: Role.ADMIN });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return [Permission.UserDelete, Permission.UserCreate];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('OPERATOR 拥有 UserRead 权限时应放行', async () => {
      const context = createMockContext({ role: Role.OPERATOR });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return [Permission.UserRead];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('OPERATOR 缺少 UserDelete 权限时应拦截', async () => {
      const context = createMockContext({ role: Role.OPERATOR });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return [Permission.UserDelete];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });

    it('USER 角色缺少管理员权限时应拦截', async () => {
      const context = createMockContext({ role: Role.USER });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return [Permission.UserCreate];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });

    it('多权限要求需全部满足', async () => {
      const context = createMockContext({ role: Role.OPERATOR });
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === PERMISSIONS_KEY) return [Permission.UserRead, Permission.UserDelete];
        return undefined;
      });

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });
  });
});

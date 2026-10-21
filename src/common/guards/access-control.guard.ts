import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CasbinService } from '@/common/auth/casbin/casbin.service';
import { Permission } from '@/common/constants/permissions';
import { Role } from '@/common/constants/roles';
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';

/**
 * 统一访问控制守卫 (AccessControlGuard)
 *
 * 判定顺序（无约束即短路）：
 * 1. 无 `@Roles()` / `@Permissions()` 约束 → 放行（覆盖 90%+ 常规路由）；
 * 2. `@Public()` → 放行；
 * 3. 取 `user.role`，缺失即拒绝；
 * 4. `@Roles() ` → 角色成员校验（声明即生效，不做管理员隐式放行）；
 * 5. `@Permissions()` → 交由 Casbin 引擎判定（策略源 `ROLE_PERMISSIONS` → `policy.csv`）。
 *
 * 管理员在角色维度不再享有隐式通行权：`@Roles(Role.OPERATOR)` 只对 OPERATOR 生效。
 * 需要管理者参与时显式声明 `@Roles(Role.OPERATOR, Role.ADMIN, Role.SUPER_ADMIN)`，
 * 否则未来的「仅超管可见」端点会被静默放开。权限维度由 Casbin 策略自然继承，不受影响。
 */
@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly casbin: CasbinService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 方法级声明优先于类级（getAllAndOverride 单遍读取，避免重复构造目标数组）
    const targets = [context.getHandler(), context.getClass()];

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);

    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const { user } = context.switchToHttp().getRequest();
    const userRole = user?.role as Role | undefined;
    if (!userRole) return false;

    if (requiredRoles?.length && !requiredRoles.includes(userRole)) {
      return false;
    }

    if (requiredPermissions?.length) {
      const decisions = await Promise.all(requiredPermissions.map((p) => this.casbin.can(userRole, p)));
      return decisions.every(Boolean);
    }

    return true;
  }
}

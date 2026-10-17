import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Permission } from '@/common/constants/permissions';
import { ROLE_PERMISSIONS } from '@/common/constants/role-permissions';
import { Role } from '@/common/constants/roles';
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';

/**
 * 统一访问控制守卫 (AccessControlGuard)
 *
 * 极致性能优化单遍判定：
 * 1. 优先提取 `@Roles()` 与 `@Permissions()` 约束，若无约束直接 O(1) 短路放行（跳过 public 与 user 检查）；
 * 2. 检查 `@Public()`：公开路由短路放行；
 * 3. 校验请求中的 `user.role`：
 *    - 若为 `Role.ADMIN`，具备超级管理员权限直接放行
 *    - 若有 `@Roles(Role.XYZ)` 约束且满足角色，放行
 *    - 若有 `@Permissions(Permission.XYZ)` 约束，校验 `ROLE_PERMISSIONS[user.role]` 是否包含所需权限
 */
@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 方法级声明优先于类级（getAllAndOverride 单遍读取，避免重复构造目标数组）
    const targets = [context.getHandler(), context.getClass()];

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);

    // 无角色且无权限约束，90%+ 常规路由在此 O(1) 极速短路放行
    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const { user } = context.switchToHttp().getRequest();
    const userRole = user?.role as Role | undefined;
    if (!userRole) return false;

    // 超级管理员默认拥有全部权限与角色访问权
    if (userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN) return true;

    // 角色校验（若有定义）
    if (requiredRoles?.length && !requiredRoles.includes(userRole)) {
      return false;
    }

    // 权限校验（若有定义）
    if (requiredPermissions?.length) {
      const userPermissions = ROLE_PERMISSIONS[userRole] ?? [];
      if (!requiredPermissions.every((p) => userPermissions.includes(p))) {
        return false;
      }
    }

    return true;
  }
}

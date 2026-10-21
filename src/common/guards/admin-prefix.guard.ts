import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '@/common/constants/roles';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';

/** 管理后台路由前缀（精确匹配 '/admin' 或 '/admin/...'，避免 '/admin-xxx' 误伤） */
const ADMIN_PREFIX = '/admin';

/**
 * 可进入应用管理面（`/admin/*`）的角色。
 *
 * 注意与 Better Auth 的 `adminRoles`（仅 SUPER_ADMIN / ADMIN）区分：
 * 本守卫只负责放行进「应用管理面」，细粒度权限由 Casbin 按 `@Permissions()` 逐条判定；
 * `adminRoles` 管辖的是 `/v1/auth/admin/*` 认证插件治理端点。OPERATOR 能进前者、进不了后者。
 */
const VALID_ADMIN_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR];

/**
 * 管理前缀默认拒绝守卫 (AdminPrefixGuard)
 *
 * 1. 非 /admin 路径直接放行；
 * 2. 标记了 @Public() 的 /admin 端点（如 /admin/auth/login）直接放行；
 * 3. 其余 /admin 路径强制要求已通过鉴权且持有合法管理角色。
 */
@Injectable()
export class AdminPrefixGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const rawUrl = String(request.url ?? '').split('?')[0];
    const path = rawUrl.replace(/\/+/g, '/').replace(/^\/(?:api\/)?(?:v\d+\/)?/, '/');

    if (path !== ADMIN_PREFIX && !path.startsWith(`${ADMIN_PREFIX}/`)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const user = request.user;
    if (!user) return false;

    return VALID_ADMIN_ROLES.includes(user.role);
  }
}

import { Policy, type Ability, type PolicyBefore } from '@nestjs/authorization';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

const hasRole = (user: CurrentUserPayload | null, roles: readonly Role[]): boolean =>
  !!user && roles.includes(user.role);

const ADMIN_ROLES = [Role.ADMIN, Role.OPERATOR] as const;
const ADMIN_ONLY = [Role.ADMIN] as const;

/**
 * 管理面策略：按能力划分 ADMIN / OPERATOR 权限，SUPER_ADMIN 直通。
 *
 * SUPER_ADMIN 通过 `before()` 放行所有能力；ADMIN / OPERATOR 按能力细分。
 */
@Policy()
export class AdminPolicy implements PolicyBefore<CurrentUserPayload, Ability<AdminPolicy>> {
  before(user: CurrentUserPayload | null): boolean | undefined {
    if (user?.role === Role.SUPER_ADMIN) {
      return true;
    }
  }

  /** 仪表盘与通知：ADMIN / OPERATOR 可访问 */
  viewDashboard(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ROLES);
  }

  sendNotification(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ROLES);
  }

  /** 用户读取：原 UserRead 授予 ADMIN / OPERATOR */
  listUsers(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ROLES);
  }

  /** 用户写入：原 UserCreate / UserDelete 仅 ADMIN */
  createUser(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ONLY);
  }

  deleteUser(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ONLY);
  }

  /** 用户更新：原 UserUpdate 授予 ADMIN / OPERATOR */
  updateUser(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ROLES);
  }

  /** 角色变更：仅 ADMIN（SUPER_ADMIN 由 before 放行，且不得越级由服务层兜底） */
  changeUserRole(user: CurrentUserPayload | null): boolean {
    return hasRole(user, ADMIN_ONLY);
  }
}

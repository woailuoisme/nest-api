import { Policy, type Ability, type PolicyBefore } from '@nestjs/authorization';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

/**
 * 自助面用户详情策略：本人或管理角色可读。
 *
 * 原先 `@Permissions(UserRead)` 覆盖全部角色，归属校验在 controller 内完成；
 * 改用路由级能力后，越权在守卫阶段即返回 403。
 */
@Policy()
export class UserPolicy implements PolicyBefore<CurrentUserPayload, Ability<UserPolicy>> {
  before(user: CurrentUserPayload | null): boolean | undefined {
    if (user?.role === Role.SUPER_ADMIN || user?.role === Role.ADMIN) {
      return true;
    }
  }

  view(user: CurrentUserPayload | null, targetId: string): boolean {
    if (!user) {
      return false;
    }
    return user.id === targetId || user.role === Role.OPERATOR;
  }
}

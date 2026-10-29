import { Policy, type Ability, type PolicyBefore } from '@nestjs/authorization';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

const IOT_ROLES: readonly Role[] = [Role.OPERATOR, Role.ADMIN];

/** 物联网设备面：原 `@Roles(OPERATOR, ADMIN, SUPER_ADMIN)` 的角色集合 */
@Policy()
export class IotPolicy implements PolicyBefore<CurrentUserPayload, Ability<IotPolicy>> {
  before(user: CurrentUserPayload | null): boolean | undefined {
    if (user?.role === Role.SUPER_ADMIN) {
      return true;
    }
  }

  accessDevices(user: CurrentUserPayload | null): boolean {
    return !!user && IOT_ROLES.includes(user.role);
  }
}

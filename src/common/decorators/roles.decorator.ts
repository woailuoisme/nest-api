import { SetMetadata } from '@nestjs/common';

import type { Role } from '@/common/constants/roles';

export const ROLES_KEY = 'roles';

/**
 * 角色控制装饰器：用于在路由方法或控制器上标注允许访问的角色列表，结合 AccessControlGuard 进行访问控制。
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

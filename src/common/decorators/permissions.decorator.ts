import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@/common/constants/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 权限控制装饰器：用于在路由方法上标注所需的细粒度权限集合，由 AccessControlGuard 读取并校验。
 */
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

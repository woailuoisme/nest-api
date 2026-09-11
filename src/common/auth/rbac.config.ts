import { admin } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import { Role } from '@/common/constants/roles';

/**
 * 声明多层级 RBAC 权限语句集合
 */
export const statement = {
  ...defaultStatements,
  ...adminAc.statements,
} as const;

export const ac = createAccessControl(statement);

export const USER = ac.newRole({});
export const OPERATOR = ac.newRole({ ...adminAc.statements });
export const ADMIN = ac.newRole({ ...adminAc.statements });
export const SUPER_ADMIN = ac.newRole({ ...adminAc.statements });

export const rbacRoles = {
  SUPER_ADMIN,
  ADMIN,
  OPERATOR,
  USER,
};

/**
 * 预装配的 Better Auth Admin RBAC 插件
 */
export const adminRbacPlugin = admin({
  ac,
  roles: rbacRoles,
  adminRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR],
  defaultRole: Role.USER,
});

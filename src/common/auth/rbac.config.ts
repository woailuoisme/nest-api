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
/**
 * 运营角色：仅具备用户查看与更新能力（对齐 `ROLE_PERMISSIONS` 的 OPERATOR 子集）。
 *
 * 其权限实际由 Casbin 策略在 `/v1/admin/*` 业务端点上约束；本声明只描述权限水位，
 * 且 OPERATOR 不在下方 `adminRoles` 中，因此不能调用 `/v1/auth/admin/*` 治理端点。
 * 绝不能直接复用 `adminAc.statements`：那会声明出与真实权限不符的完全管理员水位。
 */
export const OPERATOR = ac.newRole({ user: ['list', 'get', 'update'], session: [] });
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
  // 双层准入模型：
  // - 应用管理面（/v1/admin/*）由 AdminPrefixGuard + Casbin 把关，OPERATOR 可进；
  // - 认证插件治理面（/v1/auth/admin/*）只开放给全量权限角色。
  // 两层职责不同，故 OPERATOR 出现在前者名单而缺席此处，属预期而非遗漏。
  adminRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  defaultRole: Role.USER,
});

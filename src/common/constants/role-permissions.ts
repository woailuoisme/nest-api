import { Permission } from './permissions';
import { Role } from './roles';

/**
 * 角色 → 权限映射（Casbin 策略的唯一事实源）。
 *
 * **ADMIN 与 SUPER_ADMIN 的权限集刻意等价**，这是有意设计而非遗漏：
 * - 两者差异体现在**同级管理**上：只有 SUPER_ADMIN 可以委任/降级另一个 SUPER_ADMIN
 *   （见 `UsersService.changeRole` 的 ROLE_RANK 同行判断），ADMIN 无法动同级或更高角色；
 * - 不能把 ADMIN 降为子集：`adminRbacPlugin.adminRoles`（better-auth admin 插件）
 *   按「拥有全量权限的角色」推导，一旦 ADMIN 不是全量，就会同时失去 /v1/auth/admin/* 能力，
 *   那是一次独立的产品决策（封禁/会话管理/模拟登录等），不能顺带完成。
 *
 * 若产品上确实要收紧 ADMIN，请同时调整这里与 `adminRbacPlugin.adminRoles`，
 * 并重新执行 `just rbac-gen`。
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  [Role.OPERATOR]: [Permission.UserRead, Permission.UserUpdate, Permission.ReportRead],
  [Role.USER]: [Permission.UserRead],
};

/**
 * 统一用户与管理员角色枚举
 */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  USER = 'USER',
}

/** 向后兼容别名 */
export const AdminRole = {
  SUPER_ADMIN: Role.SUPER_ADMIN,
  ADMIN: Role.ADMIN,
  OPERATOR: Role.OPERATOR,
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

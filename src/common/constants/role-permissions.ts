import { Permission } from './permissions';
import { Role } from './roles';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  [Role.OPERATOR]: [Permission.UserRead, Permission.UserUpdate, Permission.ReportRead],
  [Role.USER]: [Permission.UserRead],
};

import { Permission } from './permissions';
import { Role } from './roles';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.MANAGER]: [Permission.UserRead, Permission.UserUpdate, Permission.ReportRead],
  [Role.USER]: [Permission.UserRead],
};

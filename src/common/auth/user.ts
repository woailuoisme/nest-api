import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { user } from '@/database/drizzle/schema';

export type UserRow = typeof user.$inferSelect;

/** `user` 行 → 认证层用户对象（绝不携带密码哈希） */
export function toAuthUser(row: UserRow): CurrentUserPayload {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: (row.role as Role | null) ?? Role.USER,
    image: row.image,
    emailVerified: row.emailVerified,
    banned: row.banned ?? false,
  };
}

import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@/common/constants/roles';

// ─── 响应 DTO ────────────────────────────────────────────

/**
 * 用户实体（前端自助面）
 *
 * 与 admin 管理面实体相互独立、零 import：两端可见字段可随策略独立演化
 * （如自助面将来可隐藏 role 等管理语义字段）。
 */
export class UserEntity {
  @ApiProperty({ example: '018e3d60-0000-7000-8000-000000000001', description: '用户ID' })
  id: string;

  @ApiProperty({ example: '张三', description: '用户名' })
  name: string;

  @ApiProperty({ example: 'zhangsan@example.com', description: '邮箱' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER, description: '角色' })
  role: Role;

  @ApiProperty({ example: 'http://example.com/avatar.jpg', nullable: true, description: '头像URL' })
  image: string | null;

  @ApiProperty({ example: 'http://example.com/avatar.jpg', nullable: true, description: '头像URL (别名)' })
  avatarUrl: string | null;

  @ApiProperty({ example: true, description: '邮箱是否已验证' })
  emailVerified: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z', description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z', description: '更新时间' })
  updatedAt: Date;

  constructor(
    partial: Omit<Partial<UserEntity>, 'role' | 'createdAt' | 'updatedAt'> & {
      role?: Role | string | null;
      image?: string | null;
      avatarUrl?: string | null;
      emailVerifiedAt?: Date | null;
      createdAt?: Date | number | string | null;
      updatedAt?: Date | number | string | null;
    },
  ) {
    Object.assign(this, partial);
    this.role = (partial.role as Role) ?? Role.USER;
    if (partial.createdAt) {
      const ts =
        typeof partial.createdAt === 'number' && partial.createdAt < 1e11
          ? partial.createdAt * 1000
          : partial.createdAt;
      this.createdAt = partial.createdAt instanceof Date ? partial.createdAt : new Date(ts);
    }
    if (partial.updatedAt) {
      const ts =
        typeof partial.updatedAt === 'number' && partial.updatedAt < 1e11
          ? partial.updatedAt * 1000
          : partial.updatedAt;
      this.updatedAt = partial.updatedAt instanceof Date ? partial.updatedAt : new Date(ts);
    }
    this.avatarUrl = partial.avatarUrl ?? partial.image ?? null;
    this.image = partial.image ?? partial.avatarUrl ?? null;
    this.emailVerified = partial.emailVerified ?? Boolean(partial.emailVerifiedAt);
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { Role } from '@/common/constants/roles';
import { toDate } from '@/common/utils/date.util';

// ─── 响应 DTO ────────────────────────────────────────────

/**
 * 用户资源输出契约（前端自助面）
 *
 * 与 admin 管理面相互独立：以白名单裁剪 `new UserEntity(row)` 带入的 user 表其余列，
 * 同时作为 `@SerializeOptions({ schema })` 运行时序列化与 OpenAPI 文档的单一事实源。
 */
export const UserResourceSchema = z.object({
  id: z.string().describe('用户ID'),
  name: z.string().describe('用户名'),
  email: z.string().describe('邮箱'),
  role: z.enum(Role).describe('角色'),
  avatarPath: z.string().nullable().describe('头像相对存储路径'),
  avatarUrl: z.string().nullable().describe('头像优化访问URL (imgproxy 动态生成)'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  createdAt: z.date().describe('创建时间'),
  updatedAt: z.date().describe('更新时间'),
});

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

  @ApiProperty({ example: 'avatars/20261031/uuid.png', nullable: true, description: '头像相对存储路径' })
  avatarPath: string | null;

  @ApiProperty({ example: 'http://localhost:8080/signature/plain/...', nullable: true, description: '头像优化访问URL' })
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
      avatarPath?: string | null;
      avatarUrl?: string | null;
      emailVerifiedAt?: Date | null;
      createdAt?: Date | number | string | null;
      updatedAt?: Date | number | string | null;
    },
  ) {
    Object.assign(this, partial);
    this.role = (partial.role as Role) ?? Role.USER;
    if (partial.createdAt) {
      this.createdAt = toDate(partial.createdAt);
    }
    if (partial.updatedAt) {
      this.updatedAt = toDate(partial.updatedAt);
    }
    this.avatarPath = partial.avatarPath ?? null;
    this.avatarUrl = partial.avatarUrl ?? null;
    this.emailVerified = partial.emailVerified ?? Boolean(partial.emailVerifiedAt);
  }
}

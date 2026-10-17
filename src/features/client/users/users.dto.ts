import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { Role } from '@/common/constants/roles';

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
  image: z.string().nullable().describe('头像URL'),
  avatarUrl: z.string().nullable().describe('头像URL (别名)'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  createdAt: z.date().describe('创建时间'),
  updatedAt: z.date().describe('更新时间'),
});

/** 秒级时间戳上界：小于该量级视为秒级（毫秒时间戳自 1973 年起即远超此值） */
const SECONDS_TIMESTAMP_UPPER_BOUND = 1e11;

/** 归一化时间字段：兼容 Date / 秒级或毫秒级时间戳 / 日期字符串 */
function toDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    return value;
  }
  const ms = typeof value === 'number' && value < SECONDS_TIMESTAMP_UPPER_BOUND ? value * 1000 : value;
  return new Date(ms);
}

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
      this.createdAt = toDate(partial.createdAt);
    }
    if (partial.updatedAt) {
      this.updatedAt = toDate(partial.updatedAt);
    }
    this.avatarUrl = partial.avatarUrl ?? partial.image ?? null;
    this.image = partial.image ?? partial.avatarUrl ?? null;
    this.emailVerified = partial.emailVerified ?? Boolean(partial.emailVerifiedAt);
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import { Role } from '@/common/constants/roles';
import { PageOptionsSchema, paginatedEnvelopeSchema } from '@/common/dto/pagination.dto';
import { SpatieQueryParamsSchema } from '@/common/dto/query.dto';

// ─── 请求 DTO（Nest 12 原生 Standard Schema：schema 即契约，类型由 z.infer 派生）────────

// strict: 未知字段当前静默丢弃（z.object strip）；收紧为 strictObject 属破坏性变更，需单独评估
export const CreateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).describe('用户名称'),
  email: z.email().toLowerCase().trim().describe('电子邮箱'),
  password: z.string().min(8).max(72).describe('密码 (8-72位)'),
  role: z.enum(Role).optional().describe('角色'),
});

export type CreateUserRequest = z.infer<typeof CreateUserSchema>;

export const FindUsersSchema = PageOptionsSchema.extend(SpatieQueryParamsSchema.shape).extend({
  search: z.string().optional().describe('按姓名或邮箱模糊搜索'),
  role: z.enum(Role).optional().describe('按角色筛选（等价 filter[role]=<role>）'),
});

export type FindUsersRequest = z.infer<typeof FindUsersSchema>;

export const SearchUsersSchema = PageOptionsSchema.extend({
  q: z.string().default('').describe('搜索关键词'),
  role: z.enum(Role).optional().describe('按角色筛选'),
});

export type SearchUsersRequest = z.infer<typeof SearchUsersSchema>;

// strict: 未知字段当前静默丢弃；收紧需单独评估（存量客户端可能携带额外字段）
export const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional().describe('用户名称'),
  email: z.email().toLowerCase().trim().optional().describe('电子邮箱'),
});

export type UpdateUserRequest = z.infer<typeof UpdateUserSchema>;

// strict: 未知字段当前静默丢弃；收紧需单独评估（与 UpdateUserSchema 同一策略）
export const ChangeRoleSchema = z.object({
  role: z.enum(Role).describe('目标角色'),
});

export type ChangeRoleRequest = z.infer<typeof ChangeRoleSchema>;

// ─── 响应 DTO ────────────────────────────────────────────

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
 * 用户资源输出契约（运行时响应序列化 + OpenAPI 文档的单一事实源）
 *
 * 以白名单方式裁剪 `new UserEntity(row)` 自 `user` 表带入的其余列
 * （twoFactorEnabled / phoneNumber / lastLoginMethod 等），杜绝敏感字段意外外泄。
 */
export const UserResourceSchema = z.object({
  id: z.string().describe('用户ID'),
  name: z.string().describe('用户名'),
  email: z.string().describe('邮箱'),
  role: z.enum(Role).describe('角色'),
  image: z.string().nullable().describe('头像URL'),
  avatarUrl: z.string().nullable().describe('头像URL (别名)'),
  emailVerified: z.boolean().describe('邮箱是否已验证'),
  banned: z.boolean().nullish().describe('是否被封禁'),
  banReason: z.string().nullish().describe('封禁原因'),
  createdAt: z.date().describe('创建时间'),
  updatedAt: z.date().describe('更新时间'),
});

/** 用户分页列表输出契约（`{ items, meta }` 信封） */
export const UserPageResourceSchema = paginatedEnvelopeSchema(UserResourceSchema);

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

  @ApiProperty({ example: false, nullable: true, description: '是否被封禁' })
  banned: boolean | null;

  @ApiProperty({ example: null, nullable: true, description: '封禁原因' })
  banReason: string | null;

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

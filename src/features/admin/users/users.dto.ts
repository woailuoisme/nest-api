import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '@/common/constants/roles';
import { PageOptionsSchema } from '@/common/dto/pagination.dto';

// ─── 请求 DTO ────────────────────────────────────────────

export const CreateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).describe('用户名称'),
  email: z.email().toLowerCase().trim().describe('电子邮箱'),
  password: z.string().min(8).max(72).describe('密码 (8-72位)'),
  role: z.enum(Role).optional().describe('角色'),
});

export class CreateUserRequest extends createZodDto(CreateUserSchema) {}

export const FindUsersSchema = PageOptionsSchema.extend({
  search: z.string().optional().describe('按姓名或邮箱模糊搜索'),
  role: z.enum(Role).optional().describe('按角色筛选'),
  sort: z.string().optional().describe('排序表达式 (如 -createdAt,name)'),
  filter: z.record(z.string(), z.string()).optional().describe('Spatie 风格过滤对象'),
});

export class FindUsersRequest extends createZodDto(FindUsersSchema) {}

export const SearchUsersSchema = PageOptionsSchema.extend({
  q: z.string().default('').describe('搜索关键词'),
  role: z.enum(Role).optional().describe('按角色筛选'),
});

export class SearchUsersRequest extends createZodDto(SearchUsersSchema) {}

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional().describe('用户名称'),
  email: z.email().toLowerCase().trim().optional().describe('电子邮箱'),
});

export class UpdateUserRequest extends createZodDto(UpdateUserSchema) {}

export const ChangeRoleSchema = z.object({
  role: z.enum(Role).describe('目标角色'),
});

export class ChangeRoleRequest extends createZodDto(ChangeRoleSchema) {}

// ─── 响应 DTO ────────────────────────────────────────────

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

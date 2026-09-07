import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
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
});

export class FindUsersRequest extends createZodDto(FindUsersSchema) {}

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
  @ApiProperty({ example: 1, description: '用户ID' })
  id: number;

  @ApiProperty({ example: '张三', description: '用户名' })
  name: string;

  @ApiProperty({ example: 'zhangsan@example.com', description: '邮箱' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER, description: '角色' })
  role: Role;

  @ApiProperty({ example: 'http://example.com/avatar.jpg', nullable: true, description: '头像URL' })
  avatarUrl: string | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z', nullable: true, description: '邮箱验证时间' })
  emailVerifiedAt: Date | null;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z', description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z', description: '更新时间' })
  updatedAt: Date;

  @Exclude()
  passwordHash?: string | null;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}

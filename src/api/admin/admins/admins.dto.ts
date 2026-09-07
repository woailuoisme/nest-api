import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AdminRole, AdminStatus } from '@/common/constants/roles';
import { PageOptionsSchema } from '@/common/dto/pagination.dto';

// ─── 请求 DTO ────────────────────────────────────────────

export const AdminQuerySchema = PageOptionsSchema.extend({
  search: z.string().optional().describe('按姓名或邮箱模糊搜索'),
  role: z.enum(AdminRole).optional().describe('按角色筛选'),
  status: z.enum(AdminStatus).optional().describe('按状态筛选'),
});

export class AdminQueryRequest extends createZodDto(AdminQuerySchema) {}

export const CreateAdminSchema = z.object({
  name: z.string().trim().min(2).max(100).describe('管理员姓名'),
  email: z.email().toLowerCase().trim().describe('管理员邮箱'),
  password: z.string().min(6).max(72).describe('密码 (6-72位)'),
  role: z.enum(AdminRole).default(AdminRole.ADMIN).describe('管理角色'),
  status: z.enum(AdminStatus).default(AdminStatus.ACTIVE).describe('账号状态'),
  avatarUrl: z.url().optional().describe('头像 URL'),
});

export class CreateAdminRequest extends createZodDto(CreateAdminSchema) {}

export const UpdateAdminSchema = z.object({
  name: z.string().trim().min(2).max(100).optional().describe('管理员姓名'),
  password: z.string().min(6).max(72).optional().describe('重置密码 (6-72位)'),
  role: z.enum(AdminRole).optional().describe('管理角色'),
  status: z.enum(AdminStatus).optional().describe('账号状态'),
  avatarUrl: z.url().optional().nullable().describe('头像 URL'),
});

export class UpdateAdminRequest extends createZodDto(UpdateAdminSchema) {}

// ─── 响应 DTO ────────────────────────────────────────────

export class AdminItemResponse {
  @ApiProperty({ example: 1, description: '管理员 ID' })
  id: number;

  @ApiProperty({ example: 'Super Admin', description: '管理员姓名' })
  name: string;

  @ApiProperty({ example: 'admin@example.com', description: '管理员邮箱' })
  email: string;

  @ApiProperty({ enum: AdminRole, example: AdminRole.ADMIN, description: '管理角色' })
  role: AdminRole;

  @ApiProperty({ enum: AdminStatus, example: AdminStatus.ACTIVE, description: '账号状态' })
  status: AdminStatus;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', nullable: true, description: '头像 URL' })
  avatarUrl: string | null;

  @ApiProperty({ example: '2026-08-29T00:00:00.000Z', nullable: true, description: '最后登录时间' })
  lastLoginAt: string | null;

  @ApiProperty({ example: '2026-08-29T00:00:00.000Z', description: '创建时间' })
  createdAt: string;

  @ApiProperty({ example: '2026-08-29T00:00:00.000Z', description: '更新时间' })
  updatedAt: string;
}

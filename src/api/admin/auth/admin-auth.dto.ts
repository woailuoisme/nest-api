import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AdminRole, AdminStatus } from '@/common/constants/roles';

// ─── 请求 DTO ────────────────────────────────────────────

export const AdminLoginSchema = z.object({
  email: z.email().toLowerCase().trim().describe('管理员工作邮箱'),
  password: z.string().min(6).max(72).describe('后台密码 (6-72位)'),
});

export class AdminLoginRequest extends createZodDto(AdminLoginSchema) {}

export const AdminRefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).describe('刷新令牌'),
});

export class AdminRefreshTokenRequest extends createZodDto(AdminRefreshTokenSchema) {}

// ─── 响应 DTO ────────────────────────────────────────────

export class AdminProfileResponse {
  @ApiProperty({ example: 1, description: '管理员 ID' })
  id: number;

  @ApiProperty({ example: 'Super Admin', description: '真实姓名/显示名' })
  name: string;

  @ApiProperty({ example: 'admin@example.com', description: '工作邮箱' })
  email: string;

  @ApiProperty({ enum: AdminRole, example: AdminRole.SUPER_ADMIN, description: '管理角色' })
  role: AdminRole;

  @ApiProperty({ enum: AdminStatus, example: AdminStatus.ACTIVE, description: '账号状态' })
  status: AdminStatus;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', nullable: true, description: '头像 URL' })
  avatarUrl: string | null;

  @ApiProperty({ example: '2026-08-29T00:00:00.000Z', nullable: true, description: '最后登录时间' })
  lastLoginAt: string | null;
}

export class AdminTokenPairResponse {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...', description: '后台访问令牌' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...', description: '后台刷新令牌' })
  refreshToken: string;

  @ApiProperty({ type: () => AdminProfileResponse, description: '管理员简要信息' })
  admin: AdminProfileResponse;
}

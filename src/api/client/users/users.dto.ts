import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { Role } from '@/common/constants/roles';

// ─── 响应 DTO ────────────────────────────────────────────

/**
 * 用户实体（前端自助面）
 *
 * 与 admin 管理面实体相互独立、零 import：两端可见字段可随策略独立演化
 * （如自助面将来可隐藏 role 等管理语义字段）。
 */
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

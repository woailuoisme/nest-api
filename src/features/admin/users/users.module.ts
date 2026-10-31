import { Module } from '@nestjs/common';

import { MediaModule } from '@/common/media/media.module';

import { AdminUsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * 管理后台 — 用户领域模块（管理面）
 *
 * 用户管理面实现（CRUD + 角色变更），自包含于 /admin 边界下。
 * 前端自助模块（src/features/client/users/）自包含独立实现，与本模块彻底解耦。
 */
@Module({
  imports: [MediaModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class AdminUsersModule {}

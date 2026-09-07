import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * 用户自助模块（前端 API）
 *
 * 自包含承载当前用户自助端点（/users/me、/users/:id、头像上传），
 * 自有 service 与 dto，与 admin 管理面领域实现零依赖。
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

import { Module } from '@nestjs/common';
import { AdminDashboardModule } from './dashboard/dashboard.module';
import { AdminNotificationsModule } from './notifications/notifications.module';
import { AdminUsersModule } from './users/users.module';

/**
 * 管理后台聚合模块
 *
 * 后台管理领域的统一入口：
 * 包含 users (统一用户与管理员管理), notifications, dashboard 等。
 * 所有管理端点统一挂载于 /admin 前缀，准入由全局 AdminPrefixGuard 控制。
 */
@Module({
  imports: [AdminUsersModule, AdminNotificationsModule, AdminDashboardModule],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { AdminsModule } from './admins/admins.module';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminDashboardModule } from './dashboard/dashboard.module';
import { AdminNotificationsModule } from './notifications/notifications.module';
import { AdminUsersModule } from './users/users.module';

/**
 * 管理后台聚合模块
 *
 * 后台管理领域的统一入口：
 * 包含 auth (后台登录), admins (管理员管理), users (C端用户管理), notifications, dashboard 等。
 * 所有管理端点统一挂载于 /admin 前缀，准入由全局 AdminPrefixGuard 控制。
 */
@Module({
  imports: [AdminAuthModule, AdminsModule, AdminUsersModule, AdminNotificationsModule, AdminDashboardModule],
})
export class AdminModule {}

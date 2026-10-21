import { AdminModule } from '@/features/admin/admin.module';
import { AdminDashboardModule } from '@/features/admin/dashboard/dashboard.module';
import { AdminNotificationsModule } from '@/features/admin/notifications/notifications.module';
import { AdminUsersModule } from '@/features/admin/users/users.module';
import { AuthModule } from '@/features/client/auth/auth.module';
import { PaymentsModule } from '@/features/client/payments/payments.module';
import { UsersModule } from '@/features/client/users/users.module';
import { SystemModule } from '@/features/system/system.module';

/**
 * 客户端业务特性模块清单（供 Client API 文档生成与特性隔离）
 */
export const CLIENT_FEATURE_MODULES = [AuthModule, UsersModule, PaymentsModule] as const;

/**
 * 管理后台领域模块清单（供 Admin API 文档生成与管理面隔离）
 */
export const ADMIN_FEATURE_MODULES = [
  AdminModule,
  AdminUsersModule,
  AdminNotificationsModule,
  AdminDashboardModule,
] as const;

/**
 * 业务特性功能模块统一清单（包含 Controller 的特性模块与管理后台模块）
 *
 * 由 AppModule 与 CliModule 统一解构引入，确保路由发现与容器上下文 100% 对齐，
 * 彻底消除新增业务模块时忘记在 CliModule 中镜像导入的脆弱性。
 * AdminModule 为管理面边界聚合（物理位于 `src/features/admin/`），作为唯一管理入口纳入本清单。
 */
export const FEATURE_MODULES = [AuthModule, UsersModule, PaymentsModule, SystemModule, AdminModule] as const;

export * from '@/features/admin/admin.module';
export * from '@/features/admin/dashboard/dashboard.module';
export * from '@/features/admin/notifications/notifications.module';
export * from '@/features/admin/users/users.module';
export * from '@/features/client/auth/auth.module';
export * from '@/features/client/payments/payments.module';
export * from '@/features/system/system.module';

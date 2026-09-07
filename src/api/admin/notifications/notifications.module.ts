import { Module } from '@nestjs/common';
import { AdminNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * 管理后台 — 通知领域模块
 *
 * 实时通知派发领域实现（委托统一 RealtimeService 双通道投递），挂载于 /admin 前缀。
 */
@Module({
  controllers: [AdminNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class AdminNotificationsModule {}

import { Module } from '@nestjs/common';
import { AdminDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * 管理后台 — 运行时指标领域模块
 *
 * 系统指标采集与实时总线广播领域实现，挂载于 /admin 前缀。
 */
@Module({
  controllers: [AdminDashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class AdminDashboardModule {}

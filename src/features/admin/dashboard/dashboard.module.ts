import { Module } from '@nestjs/common';

import { RealtimeModule } from '@/realtime/realtime.module';

import { AdminDashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * 管理后台 — 运行时指标领域模块
 *
 * 系统指标采集与实时总线广播领域实现，挂载于 /admin 前缀。
 * 依赖 RealtimeModule 广播指标快照（显式 import，非全局模块）。
 */
@Module({
  imports: [RealtimeModule],
  controllers: [AdminDashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class AdminDashboardModule {}

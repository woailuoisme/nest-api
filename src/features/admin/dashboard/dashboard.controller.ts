import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { SystemMetricPayload } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

/**
 * 管理后台 — 运行时指标控制器
 *
 * 挂载于 /admin 前缀，准入由全局 AdminPrefixGuard 默认拒绝式强制（仅 ADMIN）。
 */
@ApiTags('仪表盘')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({ summary: '系统指标' })
  @ApiResponse({ status: 200, description: '系统运行时指标快照' })
  @Get('metrics')
  getMetrics(): SystemMetricPayload {
    return this.dashboardService.getSystemMetrics();
  }
}

import { Can } from '@nestjs/authorization';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AdminPolicy } from '@/common/authorization/policies/admin.policy';

import type { SystemMetricPayload } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

/**
 * 管理后台 — 运行时指标控制器
 *
 * 挂载于 /admin 前缀，准入由 AdminPolicy.viewDashboard 判定。
 */
@ApiTags('仪表盘')
@ApiBearerAuth()
@Can(AdminPolicy, 'viewDashboard')
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

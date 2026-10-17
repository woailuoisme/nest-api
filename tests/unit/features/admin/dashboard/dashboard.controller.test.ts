import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardController } from '@/features/admin/dashboard/dashboard.controller';
import type { DashboardService } from '@/features/admin/dashboard/dashboard.service';

describe('AdminDashboardController', () => {
  let controller: AdminDashboardController;
  let mockDashboardService: {
    getSystemMetrics: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDashboardService = {
      getSystemMetrics: vi.fn().mockReturnValue({
        channel: 'system',
        timestamp: 1700000000000,
        activeSockets: 8,
      }),
    };
    controller = new AdminDashboardController(mockDashboardService as unknown as DashboardService);
  });

  it('getMetrics 应返回 dashboardService.getSystemMetrics() 的指标快照', () => {
    const metrics = controller.getMetrics();

    expect(metrics).toEqual({
      channel: 'system',
      timestamp: 1700000000000,
      activeSockets: 8,
    });
    expect(mockDashboardService.getSystemMetrics).toHaveBeenCalled();
  });
});

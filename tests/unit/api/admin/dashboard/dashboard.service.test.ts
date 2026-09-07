import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardService } from '@/api/admin/dashboard/dashboard.service';
import type { RealtimeService } from '@/realtime/realtime.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let mockRealtimeService: {
    getActiveSocketsCount: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRealtimeService = {
      getActiveSocketsCount: vi.fn().mockReturnValue(12),
      broadcast: vi.fn(),
    };
    service = new DashboardService(mockRealtimeService as unknown as RealtimeService);
  });

  it('getSystemMetrics 传入 activeSockets 时使用传入值', () => {
    const metrics = service.getSystemMetrics(5);

    expect(metrics).toMatchObject({
      channel: 'system',
      activeSockets: 5,
      memory: {
        rssMb: expect.any(Number),
        heapTotalMb: expect.any(Number),
        heapUsedMb: expect.any(Number),
      },
      uptimeSeconds: expect.any(Number),
      timestamp: expect.any(Number),
    });
    expect(metrics.memory.heapUsedMb).toBeGreaterThan(0);
  });

  it('getSystemMetrics 未传参数时应自动调用 realtimeService.getActiveSocketsCount()', () => {
    const metrics = service.getSystemMetrics();

    expect(metrics.activeSockets).toBe(12);
    expect(mockRealtimeService.getActiveSocketsCount).toHaveBeenCalled();
  });

  it('broadcastSystemMetrics 应通过 realtimeService.broadcast 广播至 dashboard:system', () => {
    const metrics = service.broadcastSystemMetrics();

    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('dashboard:system', 'metrics:system', metrics);
  });

  it('broadcastBusinessMetric 应广播至 dashboard:business', () => {
    const metric = service.broadcastBusinessMetric('orders_per_minute', 120, { region: 'ap-east' });

    expect(metric).toMatchObject({
      channel: 'business',
      metric: 'orders_per_minute',
      value: 120,
    });
    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('dashboard:business', 'metrics:business', metric);
  });

  it('broadcastAlert 应广播至 dashboard:alerts', () => {
    const alert = service.broadcastAlert('critical', 'CPU过载', 'CPU使用率超过 95%');

    expect(alert).toMatchObject({
      channel: 'alerts',
      level: 'critical',
      title: 'CPU过载',
    });
    expect(mockRealtimeService.broadcast).toHaveBeenCalledWith('dashboard:alerts', 'metrics:alert', alert);
  });
});

import { Injectable } from '@nestjs/common';
import { RealtimeService } from '@/common/realtime/realtime.service';
import type { AlertMetricPayload, BusinessMetricPayload, SystemMetricPayload } from './dashboard.dto';

/**
 * 实时监控指标数据服务：
 * 负责收集 Node.js 系统状态、生成监控快照，并通过 RealtimeService 广播至全局实时总线。
 */
@Injectable()
export class DashboardService {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * 收集当前服务器系统与进程指标
   * @param activeSockets 可选外部传入长连接数，未传时自动从 RealtimeService 获取
   */
  getSystemMetrics(activeSockets?: number): SystemMetricPayload {
    const mem = process.memoryUsage();
    const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
    const socketsCount = activeSockets ?? this.realtimeService.getActiveSocketsCount();

    return {
      channel: 'system',
      timestamp: Date.now(),
      memory: {
        rssMb: toMb(mem.rss),
        heapTotalMb: toMb(mem.heapTotal),
        heapUsedMb: toMb(mem.heapUsed),
      },
      uptimeSeconds: Math.floor(process.uptime()),
      activeSockets: socketsCount,
    };
  }

  /**
   * 向实时总线广播系统指标快照
   */
  broadcastSystemMetrics(): SystemMetricPayload {
    const metrics = this.getSystemMetrics();
    this.realtimeService.broadcast('dashboard:system', 'metrics:system', metrics);
    return metrics;
  }

  /**
   * 构造并广播标准化业务指标
   */
  broadcastBusinessMetric(metric: string, value: number, tags?: Record<string, string>): BusinessMetricPayload {
    const payload = this.createBusinessMetric(metric, value, tags);
    this.realtimeService.broadcast('dashboard:business', 'metrics:business', payload);
    return payload;
  }

  /**
   * 构造标准化业务指标
   */
  createBusinessMetric(metric: string, value: number, tags?: Record<string, string>): BusinessMetricPayload {
    return {
      channel: 'business',
      timestamp: Date.now(),
      metric,
      value,
      tags,
    };
  }

  /**
   * 构造并广播标准化系统告警
   */
  broadcastAlert(level: 'info' | 'warn' | 'critical', title: string, message: string): AlertMetricPayload {
    const payload = this.createAlert(level, title, message);
    this.realtimeService.broadcast('dashboard:alerts', 'metrics:alert', payload);
    return payload;
  }

  /**
   * 构造标准化系统告警
   */
  createAlert(level: 'info' | 'warn' | 'critical', title: string, message: string): AlertMetricPayload {
    return {
      channel: 'alerts',
      timestamp: Date.now(),
      level,
      title,
      message,
    };
  }
}

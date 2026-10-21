import { Injectable } from '@nestjs/common';

import { RealtimeService } from '@/realtime';

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
    return this.broadcast('dashboard:system', 'metrics:system', () => this.getSystemMetrics());
  }

  /**
   * 构造并广播标准化业务指标
   */
  broadcastBusinessMetric(metric: string, value: number, tags?: Record<string, string>): BusinessMetricPayload {
    return this.broadcast('dashboard:business', 'metrics:business', () =>
      this.createBusinessMetric(metric, value, tags),
    );
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
    return this.broadcast('dashboard:alerts', 'metrics:alert', () => this.createAlert(level, title, message));
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

  /**
   * 构造并广播：收敛三处「构造 payload → 推送实时总线 → 返回 payload」的重复流程
   *
   * 推送为弱依赖：不阻塞调用方同步返回，失败由 RealtimeService 内部 warn 上报。
   */
  private broadcast<T>(channel: string, event: string, build: () => T): T {
    const payload = build();
    void this.realtimeService.broadcast(channel, event, payload);
    return payload;
  }
}

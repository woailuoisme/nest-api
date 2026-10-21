import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { RealtimeService } from '@/realtime';

/**
 * Centrifugo 实时推送中枢健康检查指示器
 *
 * 容灾设计：
 * Centrifugo 作为实时广播与在场通信中间件，属于软依赖（Soft Dependency）。
 * 当 Centrifugo 处于离线或异常状态时，系统将其标记为 'degraded' 状态，但不阻断 HTTP 服务的存活，
 * 避免因推送网关临时重启导致整个微服务 Pod 被容器平台 (K8s) 误杀。
 */
@Injectable()
export class CentrifugoHealthIndicator {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'centrifugo'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    // 驱动名取自服务层：未配置 REALTIME_URL 时报告 `none`，与「已配置但不可达」区分开
    const driver = this.realtimeService.getDriver();

    try {
      const healthStatus = await this.realtimeService.checkHealth();

      if (healthStatus.status === 'up') {
        return indicator.up({
          driver,
          nodes: healthStatus.nodesCount,
          clients: healthStatus.totalClients,
          channels: healthStatus.totalChannels,
          version: healthStatus.version,
        });
      }

      // 软依赖降级处理：报告 degraded 警告，但避免触发 Terminus 503 熔断
      return indicator.up({
        state: 'degraded',
        driver,
        message:
          driver === 'none'
            ? '未配置 REALTIME_URL：实时广播为空操作'
            : (healthStatus.error ?? 'Centrifugo is unreachable'),
      });
    } catch (error) {
      return indicator.up({
        state: 'degraded',
        driver,
        message: (error as Error).message,
      });
    }
  }
}

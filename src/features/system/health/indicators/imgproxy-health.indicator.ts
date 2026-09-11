import { Injectable, Optional } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { ImgproxyService } from '@/common/media/imgproxy/imgproxy.service';

/**
 * imgproxy 动态图像处理服务健康检查指示器
 *
 * 容灾设计：
 * imgproxy 作为图像 JIT 实时渲染微服务，属于软依赖（Soft Dependency）。
 * 当未配置或处于离线/重启状态时，系统报告 'degraded' 状态，但不阻断 HTTP 服务的存活，
 * 避免因媒体服务临时抖动导致微服务 Pod 被容器平台 (K8s) 误杀。
 */
@Injectable()
export class ImgproxyHealthIndicator {
  constructor(
    @Optional() private readonly imgproxyService: ImgproxyService | undefined,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'imgproxy'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.imgproxyService?.isConfigured()) {
      return indicator.up({
        driver: 'imgproxy',
        serviceStatus: 'disabled',
        message: 'imgproxy is not configured (IMGPROXY_URL unset)',
      });
    }

    const endpoint = this.imgproxyService.getEndpoint();
    if (!endpoint) {
      return indicator.up({
        state: 'degraded',
        driver: 'imgproxy',
        serviceStatus: 'down',
        message: 'imgproxy endpoint is invalid',
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const healthUrl = `${endpoint.replace(/\/+$/, '')}/health`;
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        return indicator.up({
          driver: 'imgproxy',
          serviceStatus: 'up',
          endpoint,
        });
      }

      return indicator.up({
        state: 'degraded',
        driver: 'imgproxy',
        serviceStatus: 'down',
        message: `imgproxy health check returned status ${res.status}`,
      });
    } catch (error) {
      return indicator.up({
        state: 'degraded',
        driver: 'imgproxy',
        serviceStatus: 'down',
        message: (error as Error).message,
      });
    }
  }
}

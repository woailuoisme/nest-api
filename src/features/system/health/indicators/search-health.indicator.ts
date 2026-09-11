import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { SearchService } from '@/common/search/search.service';

/**
 * 搜索引擎健康检查指示器
 * 检查 Meilisearch 联通性或汇报 Noop 状态
 */
@Injectable()
export class SearchHealthIndicator {
  constructor(
    private readonly searchService: SearchService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'search'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const health = await this.searchService.checkHealth();
      if (health.status === 'up') {
        return indicator.up({
          driver: health.driver,
          ...(health.version ? { version: health.version } : {}),
          ...(health.message ? { message: health.message } : {}),
        });
      }

      // 软依赖容灾降级：报告 degraded，避免软依赖瞬断触发 K8s 503 误杀
      return indicator.up({
        state: 'degraded',
        driver: health.driver,
        message: health.message ?? 'Search service is unreachable',
      });
    } catch (error) {
      return indicator.up({
        state: 'degraded',
        message: (error as Error).message,
      });
    }
  }
}

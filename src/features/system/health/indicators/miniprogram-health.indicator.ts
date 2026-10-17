import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { MiniprogramService } from '@/common/wechat/miniprogram';

/**
 * 微信小程序健康检查指示器
 *
 * 仅做本地校验（驱动类型与凭证齐全度），**不发起任何外部请求**，
 * 避免健康探针按频率持续调用微信接口并消耗接口调用凭据的配额；
 * 可捕获漏配 `MINIPROGRAM_APPSECRET`、生产误用 mock 驱动等部署事故。
 */
@Injectable()
export class MiniprogramHealthIndicator {
  constructor(
    private readonly miniprogramService: MiniprogramService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy(key = 'miniprogram'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const health = this.miniprogramService.checkHealth();
      const details = {
        driver: health.driver,
        configured: health.configured,
        ...(health.message ? { message: health.message } : {}),
      };

      // 软依赖容灾降级：小程序能力未就绪属于业务功能降级，不应触发 K8s 503 误杀
      return health.status === 'up' ? indicator.up(details) : indicator.up({ state: 'degraded', ...details });
    } catch (error) {
      return indicator.up({
        state: 'degraded',
        message: (error as Error).message,
      });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { isProductionEnv } from '@/common/constants/app.constants';
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
      // 生产环境跑 mock 驱动意味着接口返回假 openid/手机号/小程序码：必须在就绪探针上可见
      const mockInProduction = isProductionEnv() && health.driver === 'mock';

      const details = {
        driver: health.driver,
        configured: health.configured,
        ...(health.message ? { message: health.message } : {}),
        ...(mockInProduction ? { message: '生产环境运行于 mock 驱动：返回假 openid / 手机号 / 小程序码' } : {}),
      };

      // 软依赖容灾降级：小程序能力未就绪属于业务功能降级，不应触发 K8s 503 误杀
      return health.status === 'up' && !mockInProduction
        ? indicator.up(details)
        : indicator.up({ state: 'degraded', ...details });
    } catch (error) {
      return indicator.up({
        state: 'degraded',
        message: (error as Error).message,
      });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { isProductionEnv } from '@/common/constants/app.constants';
import { WepayService } from '@/common/wechat/pay';

/**
 * 微信支付健康检查指示器
 *
 * 仅做本地校验（驱动类型、验签凭据模式、平台证书缓存与到期时间），**不发起任何外部请求**，
 * 避免健康探针按频率持续打爆微信支付接口；可捕获漏挂 Secret、私钥换行符丢失、证书过期等部署事故。
 */
@Injectable()
export class WepayHealthIndicator {
  constructor(
    private readonly wepayService: WepayService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'wepay'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const health = await this.wepayService.checkHealth();
      // 生产环境跑 mock 驱动意味着支付不会产生真实交易：必须在就绪探针上可见，而非只留一行 warn 日志
      const mockInProduction = isProductionEnv() && health.driver === 'mock';

      const details = {
        driver: health.driver,
        ...(health.certificateMode ? { certificateMode: health.certificateMode } : {}),
        ...(health.certificateExpireTime ? { certificateExpireTime: health.certificateExpireTime } : {}),
        ...(health.message ? { message: health.message } : {}),
        ...(mockInProduction ? { message: '生产环境运行于 mock 驱动：支付不会产生真实交易' } : {}),
      };

      // 软依赖容灾降级：支付未就绪属于业务功能降级，不应触发 K8s 503 误杀
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

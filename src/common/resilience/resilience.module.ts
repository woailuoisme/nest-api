import { Global, Module } from '@nestjs/common';
import { ResilienceModule as NestResilienceModule, type ResiliencePreset } from '@nestjs/resilience';

/**
 * 生产级统一微服务与第三方依赖弹性预设配置 (Resilience Presets)
 */
export const RESILIENCE_PRESETS: Record<string, ResiliencePreset> = {
  /**
   * 通用三方微服务/上游接口弹性策略
   * - 超时：5s
   * - 重试：最多 2 次，带指数退避
   * - 熔断：最近 10 次调用中失败率超 50% 触发开路，半开探测 1 次，开路保护 15s
   */
  upstream: {
    timeout: '5s',
    retry: {
      attempts: 2,
      backoff: { delay: '200ms', maxDelay: '1s', factor: 2 },
    },
    circuitBreaker: {
      failureRateThreshold: 50,
      minimumCalls: 5,
      openDuration: '15s',
      halfOpenMaxCalls: 1,
    },
  },
  /**
   * 支付与结算等高敏感关键接口策略
   * - 超时：5s
   * - 重试：严格禁止自动重试（避免重复扣款/支付幽灵单），须由业务层显式幂等控制
   * - 熔断：最近 10 次调用中失败率超 50% 时开路 30s 保护核心通道
   */
  payment: {
    timeout: '5s',
    retry: false,
    circuitBreaker: {
      failureRateThreshold: 50,
      minimumCalls: 10,
      openDuration: '30s',
      halfOpenMaxCalls: 1,
    },
  },
  /**
   * 内部低时延服务策略
   * - 超时：2s
   * - 重试：快速重试 3 次，间隔 100ms
   */
  internal: {
    timeout: '2s',
    retry: {
      attempts: 3,
      backoff: { delay: '100ms', maxDelay: '500ms' },
    },
  },
};

/**
 * 全局统一可靠性与弹性容错模块 (ResilienceModule)
 *
 * 包装 NestJS 12 原生 `@nestjs/resilience`：
 * 1. 提供全局默认兜底超时预算与重试策略；
 * 2. 注册生产级常用预设策略 (upstream, payment, internal)；
 * 3. 自动将熔断开路/超时/信号中断等错误映射为合规 HTTP 503/504 状态码；
 * 4. 导出 ResilienceService 与声明式装饰器（@Retry, @CircuitBreaker, @Timeout, @Fallback, @Signal）。
 */
@Global()
@Module({
  imports: [
    NestResilienceModule.forRoot({
      defaults: {
        timeout: '15s',
        retry: {
          attempts: 2,
          backoff: { delay: '200ms', maxDelay: '2s' },
        },
      },
      presets: RESILIENCE_PRESETS,
      mapErrors: true,
    }),
  ],
  exports: [NestResilienceModule],
})
export class ResilienceModule {}

import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '@/common/decorators/public.decorator';

import { CentrifugoHealthIndicator } from './indicators/centrifugo-health.indicator';
import { DatabaseHealthIndicator } from './indicators/database-health.indicator';
import { ImgproxyHealthIndicator } from './indicators/imgproxy-health.indicator';
import { MiniprogramHealthIndicator } from './indicators/miniprogram-health.indicator';
import { MqttHealthIndicator } from './indicators/mqtt-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { SearchHealthIndicator } from './indicators/search-health.indicator';
import { ShutdownHealthIndicator } from './indicators/shutdown-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';
import { WepayHealthIndicator } from './indicators/wepay-health.indicator';

/**
 * 云原生系统健康探针控制器（严格遵循 `@nestjs/terminus` 官方契约）。
 *
 * - `GET /livez`：存活探针，`health.check([])` —— 零外部 I/O，只证明进程与事件循环可调度；
 * - `GET /readyz`：就绪探针，聚合 DB、Redis、存储、实时、搜索、支付、小程序与优雅停机状态。
 *
 * 响应体即 Terminus 官方 `{ status, info, error, details }`：
 * `info` = 通过的探针，`error` = 失败的探针，`details` = 两者并集
 * （全部健康时 `info` 与 `details` 内容相同，属官方定义的超集关系，不做裁剪）。
 * 任一探针 down 或抛异常时，`@HealthCheck()` 自动转为 503 + 同一结构。
 *
 * ⚠️ 探针必须显式 `@SkipThrottle()`：Kubelet/负载均衡高频轮询一旦撞上 429，
 * 会被判定为不健康，进而触发 Pod 重启或摘流。
 *
 * ⚠️ 存活探针刻意不带任何依赖检查（含内存阈值）：下游抖动或 GC 峰值不应导致 Pod 被杀，
 * 这类判定属于就绪探针与 HPA 的职责。
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dbIndicator: DatabaseHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly storageIndicator: StorageHealthIndicator,
    private readonly centrifugoIndicator: CentrifugoHealthIndicator,
    private readonly searchIndicator: SearchHealthIndicator,
    private readonly imgproxyIndicator: ImgproxyHealthIndicator,
    private readonly mqttIndicator: MqttHealthIndicator,
    private readonly wepayIndicator: WepayHealthIndicator,
    private readonly miniprogramIndicator: MiniprogramHealthIndicator,
    private readonly shutdownIndicator: ShutdownHealthIndicator,
  ) {}

  private get readinessIndicators() {
    return [
      () => this.dbIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
      () => this.storageIndicator.isHealthy('storage'),
      () => this.centrifugoIndicator.isHealthy('centrifugo'),
      () => this.searchIndicator.isHealthy('search'),
      () => this.imgproxyIndicator.isHealthy('imgproxy'),
      () => this.mqttIndicator.isHealthy('mqtt'),
      () => this.wepayIndicator.isHealthy('wepay'),
      () => this.miniprogramIndicator.isHealthy('miniprogram'),
      () => this.shutdownIndicator.isHealthy('shutdown'),
    ];
  }

  /**
   * 云原生存活探针 (Liveness Probe)：
   * 仅验证进程存活与 HTTP 事件循环可调度，不依赖任何外部系统。失败时触发 Pod 重启。
   */
  @Get('livez')
  @HealthCheck()
  checkLivez() {
    return this.health.check([]);
  }

  /**
   * 云原生就绪探针 (Readiness Probe)：
   * 聚合验证所有关键基础设施的连通性与可用性。失败时仅自负载均衡或 Service 摘流，不杀死进程。
   */
  @Get('readyz')
  @HealthCheck()
  checkReadyz() {
    return this.health.check(this.readinessIndicators);
  }
}

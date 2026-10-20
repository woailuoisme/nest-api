import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '@/common/decorators/public.decorator';
import { BypassTransform } from '@/common/decorators/response.decorator';

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
 * 云原生系统健康探针控制器：
 * - `GET /livez`：云原生存活探针 (Liveness Probe)，纯文本 `ok`，极速响应，零外部 I/O
 * - `GET /readyz`：云原生就绪探针 (Readiness Probe)，检测 DB、Redis、存储等全量基础设施依赖及优雅停机状态
 *
 * ⚠️ 基础设施健康探针必须显式 @SkipThrottle()，防止高频 Kubelet 轮询或 wrk 压测误触 429 导致 Pod 重启或摘流。
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
  @BypassTransform()
  @Header('Content-Type', 'text/plain')
  checkLivez(): string {
    return 'ok';
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

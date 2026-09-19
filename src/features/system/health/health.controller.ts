import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DiskHealthIndicator, HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { Public } from '@/common/decorators/public.decorator';
import { BypassLoadShedding } from '@/common/resilience';
import { CentrifugoHealthIndicator } from './indicators/centrifugo-health.indicator';
import { CircuitBreakerHealthIndicator } from './indicators/circuit-breaker-health.indicator';
import { DatabaseHealthIndicator } from './indicators/database-health.indicator';
import { ImgproxyHealthIndicator } from './indicators/imgproxy-health.indicator';
import { MiniprogramHealthIndicator } from './indicators/miniprogram-health.indicator';
import { MqttHealthIndicator } from './indicators/mqtt-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { SearchHealthIndicator } from './indicators/search-health.indicator';
import { ShutdownHealthIndicator } from './indicators/shutdown-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';
import { WepayHealthIndicator } from './indicators/wepay-health.indicator';

/** V8 堆内存上限 (500MB)：监控 JavaScript 堆对象分配，防范 JS 层面内存泄漏 */
const MEMORY_HEAP_THRESHOLD_BYTES = 500 * 1024 * 1024;

/** 进程常驻物理内存上限 (1GB)：涵盖 V8 堆、JIT 代码缓存、网络缓冲区以及 C++ 原生扩展内存，防范容器 OOM */
const MEMORY_RSS_THRESHOLD_BYTES = 1024 * 1024 * 1024;

/** 根目录磁盘空间使用率报警阈值 (90%)：超过该水位标记为不健康 */
const DISK_THRESHOLD_PERCENT = 0.9;

@ApiExcludeController()
@Public()
@BypassLoadShedding()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dbIndicator: DatabaseHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly storageIndicator: StorageHealthIndicator,
    private readonly circuitBreakerIndicator: CircuitBreakerHealthIndicator,
    private readonly centrifugoIndicator: CentrifugoHealthIndicator,
    private readonly searchIndicator: SearchHealthIndicator,
    private readonly imgproxyIndicator: ImgproxyHealthIndicator,
    private readonly mqttIndicator: MqttHealthIndicator,
    private readonly wepayIndicator: WepayHealthIndicator,
    private readonly miniprogramIndicator: MiniprogramHealthIndicator,
    private readonly shutdownIndicator: ShutdownHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  private get readinessIndicators() {
    return [
      () => this.dbIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
      () => this.storageIndicator.isHealthy('storage'),
      () => this.circuitBreakerIndicator.isHealthy('circuit_breakers'),
      () => this.centrifugoIndicator.isHealthy('centrifugo'),
      () => this.searchIndicator.isHealthy('search'),
      () => this.imgproxyIndicator.isHealthy('imgproxy'),
      () => this.mqttIndicator.isHealthy('mqtt'),
      () => this.wepayIndicator.isHealthy('wepay'),
      () => this.miniprogramIndicator.isHealthy('miniprogram'),
      () => this.shutdownIndicator.isHealthy('shutdown'),
    ];
  }

  private get livenessIndicators() {
    return [
      () => this.memory.checkHeap('memory_heap', MEMORY_HEAP_THRESHOLD_BYTES),
      () => this.memory.checkRSS('memory_rss', MEMORY_RSS_THRESHOLD_BYTES),
      () => this.disk.checkStorage('disk', { path: '/', thresholdPercent: DISK_THRESHOLD_PERCENT }),
    ];
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([...this.readinessIndicators, ...this.livenessIndicators]);
  }

  @Get('liveness')
  @HealthCheck()
  checkLiveness() {
    return this.health.check(this.livenessIndicators);
  }

  @Get('readiness')
  @HealthCheck()
  checkReadiness() {
    return this.health.check(this.readinessIndicators);
  }
}

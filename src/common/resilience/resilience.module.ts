import { Global, Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { ResilienceRegistryService } from './circuit-breaker/resilience-registry.service';
import { LoadSheddingGuard } from './load-shedding/load-shedding.guard';
import { SystemLoadSampler } from './load-shedding/system-load-sampler';

/**
 * 全局弹性容错与自适应治理模块 (ResilienceModule)
 *
 * 聚合系统核心韧性能力：
 * 1. 入站自适应负载脱落 (Load Shedding)：防 Event Loop 阻塞与堆内存 OOM；
 * 2. 出站弹性治理管道 (Cockatiel Pipeline)：断路器、重试、仓壁与超时，防下游外部依赖级联雪崩。
 */
@Global()
@Module({
  providers: [SystemLoadSampler, LoadSheddingGuard, ResilienceRegistryService, CircuitBreakerService],
  exports: [SystemLoadSampler, LoadSheddingGuard, ResilienceRegistryService, CircuitBreakerService],
})
export class ResilienceModule {}

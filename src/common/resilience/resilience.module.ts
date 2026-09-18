import { Global, Module } from '@nestjs/common';
import { LoadSheddingGuard } from './guards/index.js';
import { ResilienceEventBus } from './resilience.event-bus.js';
import { ResilienceFactory } from './resilience.factory.js';
import { ResilienceMetricsRegistry } from './resilience.metrics.js';
import { ConfigurableModuleClass } from './resilience.module-definition.js';
import { ResilienceService } from './resilience.service.js';
import { ResilienceStatesManager } from './resilience.states-manager.js';
import { SystemLoadSampler } from './samplers/index.js';

const eventBusProvider = {
  provide: ResilienceEventBus,
  useValue: ResilienceEventBus.getInstance(),
};

const metricsRegistryProvider = {
  provide: ResilienceMetricsRegistry,
  useValue: ResilienceMetricsRegistry.getInstance(),
};

@Global()
@Module({
  providers: [
    eventBusProvider,
    metricsRegistryProvider,
    ResilienceStatesManager,
    ResilienceFactory,
    ResilienceService,
    SystemLoadSampler,
    LoadSheddingGuard,
  ],
  exports: [
    eventBusProvider,
    metricsRegistryProvider,
    ResilienceStatesManager,
    ResilienceFactory,
    ResilienceService,
    SystemLoadSampler,
    LoadSheddingGuard,
  ],
})
export class ResilienceModule extends ConfigurableModuleClass {}

import type { TrafficPriority } from '../enum/index.js';
import type { SystemLoadSampler } from '../samplers/index.js';

export interface LoadShedOptions {
  /** 流量优先级层级，默认 TrafficPriority.DEFAULT */
  priority?: TrafficPriority;
  /** 底层系统负载采样器实例，默认 SystemLoadSampler.getShared() */
  sampler?: SystemLoadSampler;
}

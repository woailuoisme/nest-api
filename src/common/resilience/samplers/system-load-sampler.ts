import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TrafficPriority } from '../enum/index.js';

export interface SystemLoadMetrics {
  /** 事件循环 P95 延迟（毫秒） */
  eventLoopDelayP95Ms: number;
  /** 堆内存使用比率（0 ~ 1.0） */
  heapUsedRatio: number;
  /** 堆已使用字节数 */
  heapUsedBytes: number;
  /** 堆总分配字节数 */
  heapTotalBytes: number;
  /** 默认优先级下是否处于过载状态 */
  isOverloaded: boolean;
  /** 过载原因（若已过载） */
  overloadReason?: string;
  /** 各优先级层级当前的脱落研判状态 */
  tierStatus: Record<TrafficPriority, { shouldShed: boolean; reason?: string }>;
}

export interface PriorityThresholdConfig {
  /** 事件循环 P95 延迟阈值（毫秒） */
  maxEventLoopDelayMs: number;
  /** 堆内存使用比例警戒线（0 ~ 1.0） */
  maxHeapUsedRatio: number;
}

/** 默认最大事件循环延迟阈值（毫秒），P95 超过该值则判定为事件循环严重阻塞 */
export const DEFAULT_MAX_EVENT_LOOP_DELAY_MS = 150;

/** 默认最大堆内存使用比例警戒线（0 ~ 1.0），heapUsed / heap_size_limit 超过该值判定为内存告急 */
export const DEFAULT_MAX_HEAP_USED_RATIO = 0.85;

/** 分级阶梯自适应脱落阈值表（遵循 Google SRE 标准） */
export const TIERED_LOAD_SHEDDING_THRESHOLDS: Record<TrafficPriority, PriorityThresholdConfig> = {
  [TrafficPriority.SHEDDABLE]: {
    maxEventLoopDelayMs: 60,
    maxHeapUsedRatio: 0.75,
  },
  [TrafficPriority.DEFAULT]: {
    maxEventLoopDelayMs: DEFAULT_MAX_EVENT_LOOP_DELAY_MS,
    maxHeapUsedRatio: DEFAULT_MAX_HEAP_USED_RATIO,
  },
  [TrafficPriority.CRITICAL]: {
    maxEventLoopDelayMs: 300,
    maxHeapUsedRatio: 0.92,
  },
};

/**
 * 系统运行时负载采样器 (SystemLoadSampler)
 *
 * 采用 Node.js 原生 monitorEventLoopDelay 进行高精度（10ms 分辨率）主线程延迟直方图统计，
 * 并结合 V8 堆内存真实上限比率，支持按 TrafficPriority（CRITICAL / DEFAULT / SHEDDABLE）
 * 进行阶梯自适应过载研判与分级脱落判定。
 */
@Injectable()
export class SystemLoadSampler implements OnModuleInit, OnModuleDestroy {
  private static sharedSampler?: SystemLoadSampler;

  /** 获取或初始化全局共享采样器单例（供装饰器与无 DI 上下文使用） */
  static getShared(): SystemLoadSampler {
    if (!SystemLoadSampler.sharedSampler) {
      SystemLoadSampler.sharedSampler = new SystemLoadSampler();
      SystemLoadSampler.sharedSampler.start();
    }
    return SystemLoadSampler.sharedSampler;
  }

  /** 事件循环延迟直方图（类型由 API 推导：@types/node 24 与 26 对该类型命名不同，推导可双向兼容） */
  private histogram?: ReturnType<typeof monitorEventLoopDelay>;
  private readonly thresholds: Record<TrafficPriority, PriorityThresholdConfig> = {
    [TrafficPriority.SHEDDABLE]: { ...TIERED_LOAD_SHEDDING_THRESHOLDS[TrafficPriority.SHEDDABLE] },
    [TrafficPriority.DEFAULT]: { ...TIERED_LOAD_SHEDDING_THRESHOLDS[TrafficPriority.DEFAULT] },
    [TrafficPriority.CRITICAL]: { ...TIERED_LOAD_SHEDDING_THRESHOLDS[TrafficPriority.CRITICAL] },
  };

  constructor() {
    if (!SystemLoadSampler.sharedSampler) {
      SystemLoadSampler.sharedSampler = this;
    }
  }

  /** 支持自定义或测试调整阈值 */
  setThresholds(options?: {
    maxEventLoopDelayMs?: number;
    maxHeapUsedRatio?: number;
    tiered?: Partial<Record<TrafficPriority, Partial<PriorityThresholdConfig>>>;
  }): void {
    if (options?.maxEventLoopDelayMs !== undefined) {
      this.thresholds[TrafficPriority.DEFAULT].maxEventLoopDelayMs = options.maxEventLoopDelayMs;
    }
    if (options?.maxHeapUsedRatio !== undefined) {
      this.thresholds[TrafficPriority.DEFAULT].maxHeapUsedRatio = options.maxHeapUsedRatio;
    }
    if (options?.tiered) {
      for (const [p, cfg] of Object.entries(options.tiered)) {
        const priority = p as TrafficPriority;
        if (this.thresholds[priority] && cfg) {
          if (cfg.maxEventLoopDelayMs !== undefined) {
            this.thresholds[priority].maxEventLoopDelayMs = cfg.maxEventLoopDelayMs;
          }
          if (cfg.maxHeapUsedRatio !== undefined) {
            this.thresholds[priority].maxHeapUsedRatio = cfg.maxHeapUsedRatio;
          }
        }
      }
    }
  }

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** 启动直方图采样 */
  start(): void {
    if (!this.histogram) {
      try {
        this.histogram = monitorEventLoopDelay({ resolution: 10 });
        this.histogram.enable();
      } catch {
        // 部分受限环境或非 Node 运行时降级防御
      }
    }
  }

  /** 停止直方图采样并重置 */
  stop(): void {
    if (this.histogram) {
      this.histogram.disable();
      this.histogram = undefined;
    }
  }

  /**
   * 计算实际堆内存利用比率（0.0 ~ 1.0）
   *
   * 优先基于 V8 引擎真实分配上限 `v8.getHeapStatistics().heap_size_limit` 计算。
   * 避免直接使用动态申请页 `mem.heapTotal` 导致在 Node 冷启动或 Bun 运行时下产生误脱落。
   */
  private calculateHeapUsedRatio(mem: NodeJS.MemoryUsage): number {
    let heapLimit = 0;
    try {
      const stats = v8.getHeapStatistics?.();
      if (stats?.heap_size_limit && stats.heap_size_limit > 0) {
        heapLimit = stats.heap_size_limit;
      }
    } catch {
      // 兼容非 V8 环境或沙盒受限环境
    }

    if (!heapLimit || heapLimit <= 0) {
      heapLimit = mem.heapTotal;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return heapLimit > 0 ? round2(mem.heapUsed / heapLimit) : 0;
  }

  /** 评估指定优先级的流量当前是否应当执行脱落 (Shed) */
  shouldShed(priority: TrafficPriority = TrafficPriority.DEFAULT): { shouldShed: boolean; reason?: string } {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const p95Ns = this.histogram?.percentile(95) ?? 0;
    const eventLoopDelayP95Ms = round2(p95Ns / 1e6);

    const mem = process.memoryUsage();
    const heapUsedRatio = this.calculateHeapUsedRatio(mem);

    const threshold = this.thresholds[priority] ?? this.thresholds[TrafficPriority.DEFAULT];

    if (this.histogram && eventLoopDelayP95Ms > threshold.maxEventLoopDelayMs) {
      return {
        shouldShed: true,
        reason: `[${priority}] Event loop delay P95 (${eventLoopDelayP95Ms}ms) exceeded threshold (${threshold.maxEventLoopDelayMs}ms)`,
      };
    }

    if (heapUsedRatio > threshold.maxHeapUsedRatio) {
      return {
        shouldShed: true,
        reason: `[${priority}] Heap used ratio (${Math.round(heapUsedRatio * 100)}%) exceeded threshold (${Math.round(threshold.maxHeapUsedRatio * 100)}%)`,
      };
    }

    return { shouldShed: false };
  }

  /** 采样并获取当前实时指标及三级脱落状态快照 */
  getMetrics(): SystemLoadMetrics {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const p95Ns = this.histogram?.percentile(95) ?? 0;
    const eventLoopDelayP95Ms = round2(p95Ns / 1e6);

    const mem = process.memoryUsage();
    const heapUsedRatio = this.calculateHeapUsedRatio(mem);

    const defaultCheck = this.shouldShed(TrafficPriority.DEFAULT);

    const tierStatus: Record<TrafficPriority, { shouldShed: boolean; reason?: string }> = {
      [TrafficPriority.SHEDDABLE]: this.shouldShed(TrafficPriority.SHEDDABLE),
      [TrafficPriority.DEFAULT]: defaultCheck,
      [TrafficPriority.CRITICAL]: this.shouldShed(TrafficPriority.CRITICAL),
    };

    return {
      eventLoopDelayP95Ms,
      heapUsedRatio,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      isOverloaded: defaultCheck.shouldShed,
      overloadReason: defaultCheck.reason,
      tierStatus,
    };
  }
}

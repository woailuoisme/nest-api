import * as perfHooks from 'node:perf_hooks';
import v8 from 'node:v8';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateJitteredRetryAfter,
  DEFAULT_MAX_EVENT_LOOP_DELAY_MS,
  DEFAULT_MAX_HEAP_USED_RATIO,
  SystemLoadSampler,
  TrafficPriority,
} from '@/common/resilience';

describe('SystemLoadSampler (系统运行时负载采样器)', () => {
  let sampler: SystemLoadSampler;

  beforeEach(() => {
    sampler = new SystemLoadSampler();
  });

  afterEach(() => {
    sampler.stop();
    vi.restoreAllMocks();
  });

  it('场景 1: 生命周期钩子 onModuleInit 和 onModuleDestroy 能正确启动与停止直方图采样', () => {
    expect(() => sampler.onModuleInit()).not.toThrow();
    const metricsRunning = sampler.getMetrics();
    expect(metricsRunning).toBeDefined();
    expect(metricsRunning.heapTotalBytes).toBeGreaterThan(0);

    expect(() => sampler.onModuleDestroy()).not.toThrow();
    // 停止后再停止应具备幂等安全性
    expect(() => sampler.stop()).not.toThrow();
  });

  it('场景 2: setThresholds() 支持动态更新采样阈值', () => {
    sampler.setThresholds({
      maxEventLoopDelayMs: 15,
      maxHeapUsedRatio: 0.7,
    });

    sampler.start();
    const metrics = sampler.getMetrics();
    expect(metrics).toBeDefined();
  });

  it('场景 3: 正常指标下，isOverloaded 为 false，overloadReason 为 undefined', () => {
    sampler.start();
    const metrics = sampler.getMetrics();

    // 单元测试环境中主线程未阻塞且内存未溢出
    expect(metrics.isOverloaded).toBe(false);
    expect(metrics.overloadReason).toBeUndefined();
    expect(metrics.eventLoopDelayP95Ms).toBeGreaterThanOrEqual(0);
    expect(metrics.heapUsedRatio).toBeGreaterThanOrEqual(0);
  });

  it('场景 4: 当 Event Loop P95 延迟超过阈值时，判定为过载并提供精确原因', () => {
    sampler.start();

    // 将采样器阈值设为极小值以触发展示
    sampler.setThresholds({ maxEventLoopDelayMs: 0.001 });

    // Mock 直方图 percentile 返回 20ms (20 * 1e6 ns)
    const mockHistogram = {
      percentile: vi.fn().mockReturnValue(20 * 1e6),
      enable: vi.fn(),
      disable: vi.fn(),
    };
    (sampler as unknown as { histogram: typeof mockHistogram }).histogram = mockHistogram;

    const metrics = sampler.getMetrics();
    expect(metrics.isOverloaded).toBe(true);
    expect(metrics.overloadReason).toContain('Event loop delay P95');
    expect(metrics.overloadReason).toContain('20ms');
  });

  it('场景 5: 当 V8 堆内存使用比例超过阈值时，判定为过载并提供精确原因', () => {
    sampler.start();

    // 将内存阈值设为 50%
    sampler.setThresholds({ maxHeapUsedRatio: 0.5 });

    // Mock v8.getHeapStatistics 与 process.memoryUsage 使得使用率达到 90%
    vi.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 1000 * 1024 * 1024,
    } as v8.HeapInfo);

    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 900 * 1024 * 1024,
      heapTotal: 1000 * 1024 * 1024,
      rss: 1200 * 1024 * 1024,
      external: 10 * 1024 * 1024,
      arrayBuffers: 5 * 1024 * 1024,
    });

    const metrics = sampler.getMetrics();
    expect(metrics.isOverloaded).toBe(true);
    expect(metrics.overloadReason).toContain('Heap used ratio (90%) exceeded threshold (50%)');
    expect(metrics.heapUsedRatio).toBe(0.9);
  });

  it('场景 6: 堆总内存与 heap_size_limit 为 0 时的除零防御处理', () => {
    sampler.start();

    vi.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 0,
    } as v8.HeapInfo);

    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      external: 0,
      arrayBuffers: 0,
    });

    const metrics = sampler.getMetrics();
    expect(metrics.heapUsedRatio).toBe(0);
    expect(metrics.isOverloaded).toBe(false);
  });

  it('场景 7: 当直方图未启用或运行于降级环境时，指标安全计算并不抛错', () => {
    const freshSampler = new SystemLoadSampler();
    // 不调用 start()，模拟受限环境或尚未初始化的状态
    const metrics = freshSampler.getMetrics();
    expect(metrics.eventLoopDelayP95Ms).toBe(0);
    expect(metrics.isOverloaded).toBe(false);
    expect(metrics.overloadReason).toBeUndefined();
  });

  it('场景 8: shouldShed() 按 TrafficPriority 阶梯水位差异化脱落 (轻度过载仅脱落 SHEDDABLE)', () => {
    sampler.start();

    // 模拟 Event Loop 延迟为 80ms (大于 SHEDDABLE 60ms，但小于 DEFAULT 150ms 和 CRITICAL 300ms)
    const mockHistogram = {
      percentile: vi.fn().mockReturnValue(80 * 1e6),
      enable: vi.fn(),
      disable: vi.fn(),
    };
    (sampler as unknown as { histogram: typeof mockHistogram }).histogram = mockHistogram;

    // SHEDDABLE 应该脱落
    const sheddableCheck = sampler.shouldShed(TrafficPriority.SHEDDABLE);
    expect(sheddableCheck.shouldShed).toBe(true);
    expect(sheddableCheck.reason).toContain('[SHEDDABLE]');

    // DEFAULT 和 CRITICAL 应该安全放行
    const defaultCheck = sampler.shouldShed(TrafficPriority.DEFAULT);
    expect(defaultCheck.shouldShed).toBe(false);

    const criticalCheck = sampler.shouldShed(TrafficPriority.CRITICAL);
    expect(criticalCheck.shouldShed).toBe(false);

    // getMetrics() 包含完整的三级快照
    const metrics = sampler.getMetrics();
    expect(metrics.tierStatus.SHEDDABLE.shouldShed).toBe(true);
    expect(metrics.tierStatus.DEFAULT.shouldShed).toBe(false);
    expect(metrics.tierStatus.CRITICAL.shouldShed).toBe(false);
  });

  it('场景 9: shouldShed() 在极端过载 (Lag > 300ms) 时触发 CRITICAL 核心脱落保护', () => {
    sampler.start();

    // 模拟 Event Loop 延迟为 350ms (超过 CRITICAL 300ms 极限阈值)
    const mockHistogram = {
      percentile: vi.fn().mockReturnValue(350 * 1e6),
      enable: vi.fn(),
      disable: vi.fn(),
    };
    (sampler as unknown as { histogram: typeof mockHistogram }).histogram = mockHistogram;

    expect(sampler.shouldShed(TrafficPriority.CRITICAL).shouldShed).toBe(true);
    expect(sampler.shouldShed(TrafficPriority.DEFAULT).shouldShed).toBe(true);
    expect(sampler.shouldShed(TrafficPriority.SHEDDABLE).shouldShed).toBe(true);
  });

  it('场景 10: SystemLoadSampler.getShared() 单例与自定义分级阈值 setThresholds(tiered)', () => {
    const shared = SystemLoadSampler.getShared();
    expect(shared).toBeDefined();

    shared.setThresholds({
      tiered: {
        [TrafficPriority.SHEDDABLE]: { maxEventLoopDelayMs: 10 },
      },
    });

    const mockHistogram = {
      percentile: vi.fn().mockReturnValue(15 * 1e6), // 15ms
      enable: vi.fn(),
      disable: vi.fn(),
    };
    (shared as unknown as { histogram: typeof mockHistogram }).histogram = mockHistogram;

    expect(shared.shouldShed(TrafficPriority.SHEDDABLE).shouldShed).toBe(true);
    expect(shared.shouldShed(TrafficPriority.DEFAULT).shouldShed).toBe(false);
  });

  it('场景 11: calculateJitteredRetryAfter() 基于 AWS Jitter 模型计算出合法整数秒', () => {
    // 默认 base=5, ratio=0.3 -> [3.5, 6.5] -> round 结果应在 4 ~ 7 之间
    for (let i = 0; i < 50; i++) {
      const retryAfter = calculateJitteredRetryAfter();
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(4);
      expect(retryAfter).toBeLessThanOrEqual(7);
    }
  });

  it('场景 12: calculateJitteredRetryAfter() 在零或负数基准下始终保证 >= 1 的有效非负整数', () => {
    const zeroBase = calculateJitteredRetryAfter(0);
    expect(zeroBase).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(zeroBase)).toBe(true);

    const negativeBase = calculateJitteredRetryAfter(-5);
    expect(negativeBase).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(negativeBase)).toBe(true);
  });
});

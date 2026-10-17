import { map, of, throwError, timer } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BaseCommand,
  BulkheadStrategy,
  CacheStrategy,
  CircuitBreakerStatus,
  CircuitBreakerStrategy,
  FallbackStrategy,
  ResilienceEventBus,
  ResilienceEventType,
  ResilienceMetricsRegistry,
  ResilienceStatesManager,
  RetryStrategy,
  TimeoutStrategy,
  TrafficPriority,
} from '@/common/resilience/index.js';
import { RingBuffer } from '@/common/resilience/utils/ring-buffer.js';

describe('Resilience Industrial Best Practices (工业级可靠性最佳实践)', () => {
  describe('1. RingBuffer (定长环形缓冲区)', () => {
    it('当数据写入未达到容量时，应正确记录所有数据', () => {
      const buffer = new RingBuffer<number>(3);
      expect(buffer.size()).toBe(0);

      buffer.push(1);
      buffer.push(2);
      expect(buffer.size()).toBe(2);
      expect(buffer.toArray()).toEqual([1, 2]);
    });

    it('当数据超出容量时，应按照 FIFO 覆盖最旧的数据', () => {
      const buffer = new RingBuffer<number>(3);
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4); // 覆盖 1

      expect(buffer.size()).toBe(3);
      expect(buffer.toArray()).toEqual([2, 3, 4]);

      buffer.push(5); // 覆盖 2
      expect(buffer.toArray()).toEqual([3, 4, 5]);
    });

    it('clear() 应当重置缓冲区状态', () => {
      const buffer = new RingBuffer<string>(5);
      buffer.push('a');
      buffer.push('b');
      expect(buffer.size()).toBe(2);

      buffer.clear();
      expect(buffer.size()).toBe(0);
      expect(buffer.toArray()).toEqual([]);
    });
  });

  describe('2. CircuitBreakerStrategy 滑动窗口与状态流转 (Resilience4j 模型)', () => {
    beforeEach(async () => {
      await ResilienceStatesManager.reset();
    });

    it('调用次数未达到 minimumNumberOfCalls 时，即使失败也不应跳闸', async () => {
      const cb = new CircuitBreakerStrategy({
        name: 'cb-min-calls-test',
        slidingWindowSize: 10,
        minimumNumberOfCalls: 5,
        failureRateThreshold: 50,
      });

      // 执行 3 次失败调用（小于 minimumNumberOfCalls = 5）
      for (let i = 0; i < 3; i++) {
        try {
          await new Promise((_, reject) => {
            cb.process(throwError(() => new Error('Service down'))).subscribe({
              error: reject,
            });
          });
        } catch {
          // Expected error
        }
      }

      expect(cb.status).toBe(CircuitBreakerStatus.Closed);
      expect(cb.getMetrics().totalCalls).toBe(3);
      expect(cb.getMetrics().failureRate).toBe(100);
    });

    it('调用次数达到 minimumNumberOfCalls 且失败率 >= failureRateThreshold 时，应跳闸为 OPEN', async () => {
      const cb = new CircuitBreakerStrategy({
        name: 'cb-trip-test',
        slidingWindowSize: 10,
        minimumNumberOfCalls: 4,
        failureRateThreshold: 50,
      });

      // 2 次成功，2 次失败 => 失败率 50%，满足 >= 50%
      for (let i = 0; i < 2; i++) {
        await new Promise((resolve, reject) => {
          cb.process(of('ok')).subscribe({ next: resolve, error: reject });
        });
      }

      for (let i = 0; i < 2; i++) {
        try {
          await new Promise((_, reject) => {
            cb.process(throwError(() => new Error('Fail'))).subscribe({ error: reject });
          });
        } catch {
          // Expected
        }
      }

      expect(cb.status).toBe(CircuitBreakerStatus.Open);
      expect(cb.stateName).toBe('OPEN');
    });

    it('在睡眠时间过后进入 HALF_OPEN，且达到试探成功阈值后应恢复为 CLOSED', async () => {
      const cb = new CircuitBreakerStrategy({
        name: 'cb-half-open-test',
        slidingWindowSize: 5,
        minimumNumberOfCalls: 2,
        failureRateThreshold: 50,
        sleepWindowInMilliseconds: 50,
        permittedNumberOfCallsInHalfOpenState: 2,
        successThresholdInHalfOpenState: 2,
      });

      // 连续 2 次失败触发跳闸
      for (let i = 0; i < 2; i++) {
        try {
          await new Promise((_, reject) => {
            cb.process(throwError(() => new Error('Err'))).subscribe({ error: reject });
          });
        } catch {
          // Expected
        }
      }
      expect(cb.status).toBe(CircuitBreakerStatus.Open);

      // 等待超过 50ms 睡眠窗口
      await new Promise((r) => setTimeout(r, 80));

      // 第一次试探成功 -> 仍在 HALF_OPEN 阶段（需 2 次成功恢复）
      await new Promise((resolve, reject) => {
        cb.process(of('trial-1')).subscribe({ next: resolve, error: reject });
      });
      expect(cb.status).toBe(CircuitBreakerStatus.HalfOpen);

      // 第二次试探成功 -> 恢复 CLOSED
      await new Promise((resolve, reject) => {
        cb.process(of('trial-2')).subscribe({ next: resolve, error: reject });
      });
      expect(cb.status).toBe(CircuitBreakerStatus.Closed);
      expect(cb.getMetrics().totalCalls).toBe(0); // 清空环形缓冲区重新开始
    });

    it('慢调用比例超过 slowCallRateThreshold 时，应触发跳闸进入 OPEN', async () => {
      const cb = new CircuitBreakerStrategy({
        name: 'cb-slow-calls-test',
        slidingWindowSize: 10,
        minimumNumberOfCalls: 2,
        slowCallDurationThresholdMs: 20,
        slowCallRateThreshold: 50,
      });

      // 2 次慢调用（每次 30ms >= 20ms）
      for (let i = 0; i < 2; i++) {
        await new Promise((resolve, reject) => {
          const slow$ = timer(30).pipe(map(() => 'slow-data'));
          cb.process(slow$).subscribe({
            next: resolve,
            error: reject,
          });
        });
      }

      expect(cb.status).toBe(CircuitBreakerStatus.Open);
      expect(cb.getMetrics().slowCallRate).toBe(100);
    });
  });

  describe('3. Pipeline Strategy Sorting (策略流水线规整与洋葱圈排序)', () => {
    class TestSortCommand extends BaseCommand {
      public run(): unknown {
        return null;
      }
    }

    it('BaseCommand 应当自动将乱序的策略按照最佳实践执行优先级升序排序', () => {
      const fallback = new FallbackStrategy(() => 'fallback');
      const retry = new RetryStrategy({ maxRetries: 2 });
      const cb = new CircuitBreakerStrategy({ slidingWindowSize: 10 });
      const timeout = new TimeoutStrategy(1000);
      const cache = new CacheStrategy(5000);

      // 故意以相反的顺序传入
      const command = new TestSortCommand([fallback, retry, cb, timeout, cache]);

      const orderedPriorities = command.executionStrategies.map((s) => s.executionPriority);
      expect(orderedPriorities).toEqual([
        100, // Cache
        300, // Timeout
        600, // CircuitBreaker
        700, // Retry
        800, // Fallback
      ]);
    });

    it('当传入 disableAutoSort: true 时，应当尊重调用方自定义顺序', () => {
      const fallback = new FallbackStrategy(() => 'fallback');
      const retry = new RetryStrategy({ maxRetries: 2 });

      const command = new TestSortCommand([fallback, retry], undefined, undefined, { disableAutoSort: true });

      expect(command.executionStrategies.map((s) => s.executionPriority)).toEqual([800, 700]);
    });
  });

  describe('3. ResilienceMetricsRegistry (Prometheus 指标与可观测性)', () => {
    let registry: ResilienceMetricsRegistry;

    beforeEach(() => {
      registry = new ResilienceMetricsRegistry();
    });

    it('应当在断路器状态变更事件触发时记录最新状态并在 Prometheus 文本中呈现', () => {
      ResilienceEventBus.getInstance().emit(
        ResilienceEventType.CircuitBreakerStateChanged,
        'order-service',
        CircuitBreakerStatus.Closed,
        CircuitBreakerStatus.Open,
        'Failure rate exceeded',
      );

      const prometheusOutput = registry.toPrometheusText();
      expect(prometheusOutput).toContain('# HELP resilience_circuit_breaker_state');
      expect(prometheusOutput).toContain('# TYPE resilience_circuit_breaker_state gauge');
      expect(prometheusOutput).toContain('resilience_circuit_breaker_state{name="order-service"} 2');
    });

    it('应当正确统计调用成功、失败与重试等 Counter 指标', () => {
      ResilienceEventBus.getInstance().emit(
        ResilienceEventType.RetryAttempt,
        'payment-gateway',
        1,
        100,
        new Error('Network error'),
      );

      ResilienceEventBus.getInstance().emit(ResilienceEventType.BulkheadRejected, 'heavy-export', 5, 5);

      ResilienceEventBus.getInstance().emit(
        ResilienceEventType.LoadShedDrop,
        'background-sync',
        TrafficPriority.SHEDDABLE,
        'P99 latency threshold exceeded',
      );

      const metrics = registry.getSnapshot();
      expect(metrics.retryAttempts['payment-gateway']).toBe(1);
      expect(metrics.bulkheadRejections['heavy-export']).toBe(1);
      expect(metrics.loadShedDrops['background-sync']?.[TrafficPriority.SHEDDABLE]).toBe(1);

      const prometheusOutput = registry.toPrometheusText();
      expect(prometheusOutput).toContain('resilience_retry_attempts_total{name="payment-gateway"} 1');
      expect(prometheusOutput).toContain('resilience_bulkhead_rejected_total{name="heavy-export"} 1');
      expect(prometheusOutput).toContain(
        'resilience_load_shed_dropped_total{name="background-sync",priority="SHEDDABLE"} 1',
      );
    });

    it('应当支持清空指标与重置 (reset)', () => {
      ResilienceEventBus.getInstance().emit(ResilienceEventType.BulkheadRejected, 'test-cmd', 1, 1);
      expect(registry.getSnapshot().bulkheadRejections['test-cmd']).toBe(1);

      registry.reset();
      expect(registry.getSnapshot().bulkheadRejections['test-cmd']).toBeUndefined();
    });
  });
});

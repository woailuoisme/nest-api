import { Controller, Get, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CircuitBreaker,
  CircuitOpenError,
  Fallback,
  RESILIENCE_PRESETS,
  Resilience,
  ResilienceModule,
  ResilienceService,
  ResilienceTimeoutError,
  Retry,
  Signal,
  Timeout,
} from '@/common/resilience';

@Controller('resilience-test')
class TestResilienceController {
  public attempts = 0;
  public breakerAttempts = 0;
  public fallbackCalls = 0;

  @Get('retry-success')
  @Retry({ attempts: 3, backoff: { delay: '5ms', maxDelay: '20ms' } })
  retrySuccess(): string {
    this.attempts++;
    if (this.attempts < 3) {
      throw new Error(`Transient failure on attempt ${this.attempts}`);
    }
    return 'recovered_data';
  }

  @Get('retry-exhausted')
  @Retry({ attempts: 2, backoff: { delay: '5ms' } })
  retryExhausted(): string {
    this.attempts++;
    throw new HttpException('Persistent failure', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  @Get('circuit-breaker')
  @CircuitBreaker({
    name: 'controller-cb',
    minimumCalls: 2,
    failureRateThreshold: 50,
    openDuration: '200ms',
  })
  circuitBreakerRoute(): string {
    this.breakerAttempts++;
    if (this.breakerAttempts <= 2) {
      throw new HttpException('Downstream failure', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return 'ok';
  }

  @Get('fallback')
  @Fallback('fallbackHandler', {
    handleIf: (err: unknown) => err instanceof CircuitOpenError,
  })
  @CircuitBreaker({
    name: 'fallback-cb',
    minimumCalls: 1,
    failureRateThreshold: 50,
    openDuration: '500ms',
  })
  callWithFallback(): string {
    throw new HttpException('Target failed', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  fallbackHandler(): { status: string; fromFallback: boolean } {
    this.fallbackCalls++;
    return { status: 'degraded_ok', fromFallback: true };
  }

  @Get('timeout')
  @Timeout('25ms')
  async slowRoute(@Signal() signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('slow_success'), 150);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Operation aborted'));
      });
    });
  }

  @Get('preset-upstream')
  @Resilience('upstream')
  async upstreamPresetRoute(): Promise<string> {
    return 'upstream_preset_ok';
  }
}

describe('@nestjs/resilience 弹性与容错模块集成测试', () => {
  let app: NestFastifyApplication;
  let moduleRef: TestingModule;
  let controller: TestResilienceController;
  let resilienceService: ResilienceService;

  beforeEach(async () => {
    vi.restoreAllMocks();

    moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule],
      controllers: [TestResilienceController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    controller = moduleRef.get(TestResilienceController);
    resilienceService = moduleRef.get(ResilienceService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('预设策略配置验证 (RESILIENCE_PRESETS)', () => {
    it('upstream 预设应配置适度重试、超时与熔断器', () => {
      const upstream = RESILIENCE_PRESETS.upstream;
      expect(upstream.timeout).toBe('5s');
      expect(upstream.retry).toEqual({
        attempts: 2,
        backoff: { delay: '200ms', maxDelay: '1s', factor: 2 },
      });
      expect(typeof upstream.circuitBreaker).toBe('object');
    });

    it('payment 预设应严格禁用自动重试以保障资金安全', () => {
      const payment = RESILIENCE_PRESETS.payment;
      expect(payment.retry).toBe(false);
      expect(payment.timeout).toBe('5s');
      expect(typeof payment.circuitBreaker).toBe('object');
    });

    it('internal 预设应配置 2s 超时与 3 次指数退避重试', () => {
      const internal = RESILIENCE_PRESETS.internal;
      expect(internal.timeout).toBe('2s');
      expect(internal.retry).toEqual({
        attempts: 3,
        backoff: { delay: '100ms', maxDelay: '500ms' },
      });
    });
  });

  describe('声明式路由级 @Retry 重试机制', () => {
    it('在指定失败次数内应由全局拦截器自动重试并最终成功返回', async () => {
      controller.attempts = 0;
      const res = await app.inject({
        method: 'GET',
        url: '/resilience-test/retry-success',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('recovered_data');
      expect(controller.attempts).toBe(3); // 第 1、2 次抛错，第 3 次成功返回
    });

    it('当超过最大重试次数时应抛出错误并返回对应 HTTP 状态码', async () => {
      controller.attempts = 0;
      const res = await app.inject({
        method: 'GET',
        url: '/resilience-test/retry-exhausted',
      });

      expect(res.statusCode).toBe(500);
      expect(controller.attempts).toBe(2); // 尝试 2 次后耗尽
    });
  });

  describe('声明式路由级 @CircuitBreaker 熔断器机制', () => {
    it('达到失败阈值后断路器开路并拒绝后续调用 (返回 503 Service Unavailable + Retry-After)', async () => {
      controller.breakerAttempts = 0;

      // 连续 2 次失败触发断路器开路
      const res1 = await app.inject({ method: 'GET', url: '/resilience-test/circuit-breaker' });
      expect(res1.statusCode).toBe(500);

      const res2 = await app.inject({ method: 'GET', url: '/resilience-test/circuit-breaker' });
      expect(res2.statusCode).toBe(500);

      // 第 3 次请求此时被熔断器直接拦截，映射为 503 SERVICE_UNAVAILABLE，并携带 Retry-After 响应头
      const res3 = await app.inject({ method: 'GET', url: '/resilience-test/circuit-breaker' });
      expect(res3.statusCode).toBe(503);
      expect(res3.headers['retry-after']).toBeDefined();
      expect(controller.breakerAttempts).toBe(2); // 未穿透进入控制器处理函数
    });
  });

  describe('声明式路由级 @Fallback 自动降级机制', () => {
    it('当发生 CircuitOpenError 时自动路由至 fallbackHandler 执行降级响应', async () => {
      controller.fallbackCalls = 0;

      // 第一次调用失败使 minimumCalls=1 的熔断器开路
      await app.inject({ method: 'GET', url: '/resilience-test/fallback' });

      // 第二次调用触发 CircuitOpenError，被 @Fallback 捕获并调用 fallbackHandler
      const res = await app.inject({ method: 'GET', url: '/resilience-test/fallback' });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.status).toBe('degraded_ok');
      expect(json.fromFallback).toBe(true);
      expect(controller.fallbackCalls).toBe(1);
    });
  });

  describe('声明式路由级 @Timeout 超时与 AbortSignal 联动', () => {
    it('当调用超过指定阈值时自动终止并返回 504 Gateway Timeout', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/resilience-test/timeout',
      });

      expect(res.statusCode).toBe(504);
      const json = JSON.parse(res.body);
      expect(json.message).toBe('The operation timed out');
    });
  });

  describe('声明式路由级 @Resilience 预设挂载', () => {
    it('成功应用 upstream 预设策略', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/resilience-test/preset-upstream',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('upstream_preset_ok');
    });
  });

  describe('程序化 ResilienceService API (供业务 Service 内部直接调用)', () => {
    it('可通过 execute() 动态编排重试逻辑', async () => {
      let callCount = 0;
      const policy = resilienceService.create({
        retry: { attempts: 3, backoff: { delay: '5ms' } },
      });

      const outcome = await policy.execute(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary service glitch');
        }
        return 'recovered_result';
      });

      expect(outcome).toBe('recovered_result');
      expect(callCount).toBe(3);
    });

    it('可通过 preset("upstream") 快速复用预设策略', async () => {
      let count = 0;
      const outcome = await resilienceService.preset('upstream').execute(async () => {
        count++;
        if (count === 1) {
          throw new Error('Upstream network timeout');
        }
        return 'upstream_ok';
      });

      expect(outcome).toBe('upstream_ok');
      expect(count).toBe(2);
    });

    it('payment 预设严格不重试，失败立即抛出', async () => {
      let count = 0;
      await expect(
        resilienceService.preset('payment').execute(async () => {
          count++;
          throw new Error('Payment gateway error');
        }),
      ).rejects.toThrow('Payment gateway error');

      expect(count).toBe(1);
    });
  });
});

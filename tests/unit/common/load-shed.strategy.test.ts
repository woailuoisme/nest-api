import type { ExecutionContext } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BypassLoadShedding,
  Critical,
  isLoadShedError,
  LoadSheddingGuard,
  LoadShedException,
  LoadShedStrategy,
  Priority,
  ResilienceFactory,
  Sheddable,
  SystemLoadSampler,
  TrafficPriority,
  TrafficPriorityLevel,
} from '@/common/resilience';

describe('LoadShedStrategy & LoadSheddingGuard (负载脱落策略与守卫)', () => {
  describe('LoadShedStrategy', () => {
    let mockSampler: SystemLoadSampler;

    beforeEach(() => {
      mockSampler = new SystemLoadSampler();
    });

    it('场景 1: 系统负载正常时，数据流正常透传', async () => {
      vi.spyOn(mockSampler, 'shouldShed').mockReturnValue({ shouldShed: false });

      const strategy = new LoadShedStrategy({
        priority: TrafficPriority.DEFAULT,
        sampler: mockSampler,
      });

      const source$ = of('result-ok');
      const processed$ = strategy.process(source$);
      const result = await firstValueFrom(processed$);

      expect(result).toBe('result-ok');
      expect(mockSampler.shouldShed).toHaveBeenCalledWith(TrafficPriority.DEFAULT);
    });

    it('场景 2: 系统负载过载时，抛出 LoadShedException 并携带优先级与脱落原因', async () => {
      vi.spyOn(mockSampler, 'shouldShed').mockReturnValue({
        shouldShed: true,
        reason: 'Event loop delay exceeded 60ms',
      });

      const strategy = new LoadShedStrategy({
        priority: TrafficPriority.SHEDDABLE,
        sampler: mockSampler,
      });

      const source$ = of('wont-reach');
      const processed$ = strategy.process(source$);

      await expect(firstValueFrom(processed$)).rejects.toThrow(LoadShedException);

      try {
        await firstValueFrom(processed$);
      } catch (err) {
        expect(isLoadShedError(err)).toBe(true);
        if (isLoadShedError(err)) {
          expect(err.priority).toBe(TrafficPriority.SHEDDABLE);
          expect(err.reason).toBe('Event loop delay exceeded 60ms');
        }
      }
    });

    it('场景 3: 支持通过 ResilienceFactory 创建策略实例', () => {
      const strategy1 = ResilienceFactory.createLoadShedStrategy({ priority: TrafficPriority.CRITICAL });
      expect(strategy1).toBeInstanceOf(LoadShedStrategy);
      expect(strategy1.getOptions().priority).toBe(TrafficPriority.CRITICAL);

      const factory = new ResilienceFactory();
      const strategy2 = factory.createLoadShedStrategy();
      expect(strategy2).toBeInstanceOf(LoadShedStrategy);
      expect(strategy2.getOptions().priority).toBe(TrafficPriority.DEFAULT);
    });
  });

  describe('LoadSheddingGuard', () => {
    let guard: LoadSheddingGuard;
    let reflector: Reflector;
    let mockSampler: SystemLoadSampler;

    beforeEach(() => {
      reflector = new Reflector();
      mockSampler = new SystemLoadSampler();
      guard = new LoadSheddingGuard(reflector, mockSampler);
    });

    it('场景 4: 非 HTTP 上下文（如 RPC/微服务/WebSocket）直接放行', () => {
      const mockContext = {
        getType: vi.fn().mockReturnValue('rpc'),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('场景 5: 标注了 @BypassLoadShedding 的端点即使过载也直接放行', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const shouldShedSpy = vi.spyOn(mockSampler, 'shouldShed');

      const mockContext = {
        getType: vi.fn().mockReturnValue('http'),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
      expect(shouldShedSpy).not.toHaveBeenCalled();
    });

    it('场景 6: 正常流量且未过载时放行', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      vi.spyOn(mockSampler, 'shouldShed').mockReturnValue({ shouldShed: false });

      const mockContext = {
        getType: vi.fn().mockReturnValue('http'),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('场景 7: 过载时写入 Retry-After 头部并抛出 ServiceUnavailableException', () => {
      vi.spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce(false) // isBypassed
        .mockReturnValueOnce(TrafficPriority.DEFAULT); // priority

      vi.spyOn(mockSampler, 'shouldShed').mockReturnValue({
        shouldShed: true,
        reason: 'Event loop lag',
      });

      const setHeaderMock = vi.fn();
      const mockReply = {
        header: setHeaderMock,
      } as unknown as FastifyReply;

      const mockContext = {
        getType: vi.fn().mockReturnValue('http'),
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: vi.fn().mockReturnValue({
          getResponse: vi.fn().mockReturnValue(mockReply),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(ServiceUnavailableException);

      expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', expect.any(String));
      expect(setHeaderMock).toHaveBeenCalledWith('X-Retry-After-Ms', expect.any(String));
      expect(setHeaderMock).toHaveBeenCalledWith('X-Load-Shed-Priority', TrafficPriority.DEFAULT);
    });

    it('场景 8: 装饰器元数据声明验证', () => {
      class TestController {
        @BypassLoadShedding()
        health() {}

        @TrafficPriorityLevel(TrafficPriority.CRITICAL)
        pay() {}

        @Sheddable()
        exportReport() {}

        @Critical()
        auth() {}

        @Priority(TrafficPriority.DEFAULT)
        normal() {}
      }

      const instance = new TestController();

      expect(Reflect.getMetadata('RESILIENCE:BYPASS_LOAD_SHEDDING', instance.health)).toBe(true);
      expect(Reflect.getMetadata('RESILIENCE:TRAFFIC_PRIORITY', instance.pay)).toBe(TrafficPriority.CRITICAL);
      expect(Reflect.getMetadata('RESILIENCE:TRAFFIC_PRIORITY', instance.exportReport)).toBe(TrafficPriority.SHEDDABLE);
      expect(Reflect.getMetadata('RESILIENCE:TRAFFIC_PRIORITY', instance.auth)).toBe(TrafficPriority.CRITICAL);
      expect(Reflect.getMetadata('RESILIENCE:TRAFFIC_PRIORITY', instance.normal)).toBe(TrafficPriority.DEFAULT);
    });
  });
});

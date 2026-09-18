import { describe, expect, it, vi } from 'vitest';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';

describe('PinoLoggerService', () => {
  function createMockPino() {
    return {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      level: 'info',
    };
  }

  it('应正确委托 log 到 pino.info', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.log('hello world', 'AppModule');
    expect(mockPino.info).toHaveBeenCalledWith({ context: 'AppModule' }, 'hello world');
  });

  it('应正确委托 error 到 pino.error（包含 stack 和 context）', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.error('something failed', 'stack trace here', 'HttpFilter');
    expect(mockPino.error).toHaveBeenCalledWith({ context: 'HttpFilter', err: 'stack trace here' }, 'something failed');
  });

  it('应正确委托 warn 到 pino.warn', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.warn('warning msg', 'AuthService');
    expect(mockPino.warn).toHaveBeenCalledWith({ context: 'AuthService' }, 'warning msg');
  });

  it('应正确委托 debug 到 pino.debug', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.debug('debug info', 'DatabaseService');
    expect(mockPino.debug).toHaveBeenCalledWith({ context: 'DatabaseService' }, 'debug info');
  });

  it('应正确委托 verbose 到 pino.trace', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.verbose('verbose trace', 'Tracing');
    expect(mockPino.trace).toHaveBeenCalledWith({ context: 'Tracing' }, 'verbose trace');
  });

  it('应正确委托 fatal 到 pino.fatal', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.fatal('crash', 'fatal stack', 'Bootstrap');
    expect(mockPino.fatal).toHaveBeenCalledWith({ context: 'Bootstrap', err: 'fatal stack' }, 'crash');
  });

  it('setLogLevels 应更新 pino level', () => {
    const mockPino = createMockPino();
    const service = new PinoLoggerService(mockPino as never);

    service.setLogLevels(['debug']);
    expect(mockPino.level).toBe('debug');
  });

  describe('SILENT_BOOTSTRAP_CONTEXTS 启动日志静默过滤', () => {
    it('应自动过滤 InstanceLoader / RoutesResolver / RouterExplorer / NestApplication 的 info 级别日志', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.log('ExcelModule dependencies initialized', 'InstanceLoader');
      service.log('AppController {/} (version: Neutral):', 'RoutesResolver');
      service.log('Mapped {/, GET} (version: Neutral) route', 'RouterExplorer');
      service.log('Nest application successfully started', 'NestApplication');

      expect(mockPino.info).not.toHaveBeenCalled();
    });

    it('不应拦截框架内部上下文的 warn 与 error 告警', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.warn('Circular dependency detected', 'InstanceLoader');
      service.error('Route registration failed', 'stack trace', 'RouterExplorer');

      expect(mockPino.warn).toHaveBeenCalledWith({ context: 'InstanceLoader' }, 'Circular dependency detected');
      expect(mockPino.error).toHaveBeenCalledWith(
        { context: 'RouterExplorer', err: 'stack trace' },
        'Route registration failed',
      );
    });

    it('应正常放行非静默上下文的普通 info 日志', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.log('Starting custom service...', 'CustomService');
      service.log('Worker initialized', 'WorkerModule');

      expect(mockPino.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('logHttp 访问日志', () => {
    it('2xx/3xx 请求应记录为 info 级别', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.logHttp({
        method: 'GET',
        url: '/api/v1/users',
        statusCode: 200,
        duration: 12.3,
        ip: '127.0.0.1',
      });

      expect(mockPino.info).toHaveBeenCalledWith(
        {
          method: 'GET',
          url: '/api/v1/users',
          statusCode: 200,
          duration: 12.3,
          ip: '127.0.0.1',
        },
        'GET /api/v1/users 200 (12.3ms) - 127.0.0.1',
      );
    });

    it('4xx 客户端异常请求应升为 warn 级别', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.logHttp({
        method: 'POST',
        url: '/api/v1/auth/login',
        statusCode: 401,
        duration: 25.1,
        ip: '192.168.1.1',
      });

      expect(mockPino.warn).toHaveBeenCalledWith(
        {
          method: 'POST',
          url: '/api/v1/auth/login',
          statusCode: 401,
          duration: 25.1,
          ip: '192.168.1.1',
        },
        'POST /api/v1/auth/login 401 (25.1ms) - 192.168.1.1',
      );
    });

    it('5xx 服务端错误应升为 error 级别', () => {
      const mockPino = createMockPino();
      const service = new PinoLoggerService(mockPino as never);

      service.logHttp({
        method: 'GET',
        url: '/api/v1/orders',
        statusCode: 500,
        duration: 89.4,
        ip: '10.0.0.1',
      });

      expect(mockPino.error).toHaveBeenCalledWith(
        {
          method: 'GET',
          url: '/api/v1/orders',
          statusCode: 500,
          duration: 89.4,
          ip: '10.0.0.1',
        },
        'GET /api/v1/orders 500 (89.4ms) - 10.0.0.1',
      );
    });

    it('当 pino 实例未初始化时应安全无副作用退出', () => {
      const service = new PinoLoggerService(undefined);

      expect(() => {
        service.logHttp({
          method: 'GET',
          url: '/health',
          statusCode: 200,
          duration: 1.2,
          ip: '127.0.0.1',
        });
      }).not.toThrow();
    });
  });
});

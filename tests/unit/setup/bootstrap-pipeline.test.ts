import { describe, expect, it, vi } from 'vitest';

import { createFastifyAdapter } from '@/setup/adapter';
import { isAppShuttingDown, setAppShuttingDown, setupShutdownHooks, setupWorkerShutdownHooks } from '@/setup/lifecycle';
import { PinoLoggerService } from '@/setup/logger';

describe('Bootstrap Pipeline & Lifecycle Helpers', () => {
  it('createFastifyAdapter 应返回配置了 genReqId 与 qs 解析器的 FastifyAdapter', () => {
    const adapter = createFastifyAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.getInstance).toBe('function');
  });

  it('isAppShuttingDown 和 setAppShuttingDown 应正确响应状态变化', () => {
    setAppShuttingDown(false);
    expect(isAppShuttingDown()).toBe(false);
    setAppShuttingDown(true);
    expect(isAppShuttingDown()).toBe(true);
    setAppShuttingDown(false);
  });

  it('setupShutdownHooks 应注册 SIGTERM 和 SIGINT 信号监听', () => {
    const processOnceSpy = vi.spyOn(process, 'once');
    const mockApp = {
      get: vi.fn().mockReturnValue({ get: vi.fn() }),
      getHttpServer: vi.fn().mockReturnValue({ closeIdleConnections: vi.fn() }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;

    setupShutdownHooks(mockApp);
    expect(processOnceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    processOnceSpy.mockRestore();
  });

  it('setupWorkerShutdownHooks 应注册 SIGTERM 和 SIGINT 信号监听', () => {
    const processOnceSpy = vi.spyOn(process, 'once');
    const mockApp = {
      get: vi.fn().mockReturnValue({ get: vi.fn() }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;

    setupWorkerShutdownHooks(mockApp);
    expect(processOnceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    processOnceSpy.mockRestore();
  });

  it('PinoLoggerService.logStartupSummary 应正确格式化并输出紧凑启动摘要', () => {
    const service = new PinoLoggerService();
    const logSpy = vi.spyOn(service, 'log').mockImplementation(() => {});

    service.logStartupSummary({
      appUrl: 'http://localhost:3000',
      timezone: 'UTC',
      isWorkerEmbedded: true,
      panels: [
        { label: 'API Docs', url: 'http://localhost:3000/docs' },
        { label: 'Admin Docs', url: 'http://localhost:3000/docs/admin' },
      ],
    });

    expect(logSpy).toHaveBeenCalledWith(
      '[App] Server is running: http://localhost:3000 (timezone=UTC) [Worker: active]',
    );
    expect(logSpy).toHaveBeenCalledWith(
      '[App] API Docs: http://localhost:3000/docs | Admin Docs: http://localhost:3000/docs/admin',
    );
  });
});

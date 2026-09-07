import { describe, expect, it, vi } from 'vitest';
import { createFastifyAdapter } from '@/setup/adapter';
import { setupShutdownHooks } from '@/setup/lifecycle';
import { PinoLoggerService } from '@/setup/logger';

describe('Bootstrap Pipeline & Lifecycle Helpers', () => {
  it('createFastifyAdapter 应返回配置了 genReqId 与 qs 解析器的 FastifyAdapter', () => {
    const adapter = createFastifyAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.getInstance).toBe('function');
  });

  it('setupShutdownHooks 应调用 app.enableShutdownHooks', () => {
    const mockApp = {
      enableShutdownHooks: vi.fn(),
    } as any;

    setupShutdownHooks(mockApp);
    expect(mockApp.enableShutdownHooks).toHaveBeenCalled();
  });

  it('PinoLoggerService.logStartupSummary 应正确格式化并输出启动摘要', () => {
    const service = new PinoLoggerService();
    const logSpy = vi.spyOn(service, 'log').mockImplementation(() => {});

    service.logStartupSummary({
      appUrl: 'http://localhost:3000',
      timezone: 'UTC',
      isWorkerEmbedded: true,
      panels: [
        { label: 'Swagger API Docs', url: 'http://localhost:3000/docs' },
        { label: 'BullBoard Queues', url: 'http://localhost:3000/admin/queues' },
      ],
    });

    expect(logSpy).toHaveBeenCalledWith('[App] Server is running: http://localhost:3000 (timezone=UTC)');
    expect(logSpy).toHaveBeenCalledWith('[Worker] Embedded worker active (processing queues & schedules)');
    expect(logSpy).toHaveBeenCalledWith('[App] Swagger API Docs: http://localhost:3000/docs');
    expect(logSpy).toHaveBeenCalledWith('[App] BullBoard Queues: http://localhost:3000/admin/queues');
  });
});

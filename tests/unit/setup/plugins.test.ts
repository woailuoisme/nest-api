import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, expect, it, vi } from 'vitest';
import { auth } from '@/common/auth/better-auth';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';
import { registerFastifyPlugins } from '@/setup/plugins';

vi.mock('@/common/auth/better-auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

describe('registerFastifyPlugins', () => {
  it('应正确注册 onRequest 与 onResponse hook，并在请求完成时记录访问日志', async () => {
    const hooks: Record<string, ((req: unknown, reply: unknown) => Promise<void> | void)[]> = {
      onRequest: [],
      onResponse: [],
    };

    const routes: Record<string, (req: unknown, reply: unknown) => Promise<void> | void> = {};

    const mockFastify = {
      addHook: vi.fn((event: string, hook: (req: unknown, reply: unknown) => Promise<void> | void) => {
        if (hooks[event]) {
          hooks[event].push(hook);
        }
      }),
      get: vi.fn((url: string, handler: (req: unknown, reply: unknown) => Promise<void> | void) => {
        routes[url] = handler;
      }),
    };

    const mockLoggerService = {
      logHttp: vi.fn(),
    };

    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'UPLOAD_MAX_FILE_SIZE_BYTES') return 10 * 1024 * 1024;
        return undefined;
      }),
    };

    const mockApp = {
      get: vi.fn((token: unknown) => {
        if (token === ConfigService) return mockConfigService;
        if (token === PinoLoggerService) return mockLoggerService;
        return undefined;
      }),
      getHttpAdapter: () => ({
        getInstance: () => mockFastify,
      }),
      register: vi.fn().mockResolvedValue(undefined),
    } as unknown as NestFastifyApplication;

    await registerFastifyPlugins(mockApp);

    expect(mockFastify.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
    expect(mockFastify.addHook).toHaveBeenCalledWith('onResponse', expect.any(Function));
    expect(mockFastify.get).toHaveBeenCalledWith('/favicon.ico', expect.any(Function));

    // 1. 验证 onRequest Hook 透传 x-request-id
    const onRequestHook = hooks.onRequest[0];
    const mockReq = {
      id: 'req-unique-999',
      headers: {} as Record<string, string>,
    };
    const mockReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      statusCode: 200,
      elapsedTime: 12.3,
    };
    await onRequestHook(mockReq, mockReply);
    expect(mockReq.headers['x-request-id']).toBe('req-unique-999');
    expect(mockReply.header).toHaveBeenCalledWith('x-request-id', 'req-unique-999');

    // 2. 验证 onResponse Hook 触发 logHttp 并提取 url path
    const onResponseHook = hooks.onResponse[0];
    const completedReq = {
      method: 'GET',
      url: '/api/v1/users?token=secret123&page=1',
      raw: {
        headers: { 'x-forwarded-for': '192.168.1.100' },
      },
      headers: { 'x-request-id': 'req-unique-999' },
    };
    await onResponseHook(completedReq, mockReply);

    expect(mockLoggerService.logHttp).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/v1/users',
      statusCode: 200,
      duration: 12.3,
      ip: '192.168.1.100',
    });

    // 3. 验证 /favicon.ico 路由返回 204 及 Cache-Control
    const faviconHandler = routes['/favicon.ico'];
    const faviconReply = {
      header: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    faviconHandler({}, faviconReply);
    expect(faviconReply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400, immutable');
    expect(faviconReply.code).toHaveBeenCalledWith(204);
    expect(faviconReply.send).toHaveBeenCalled();

    // 4. 运维面板（/docs、/queues、/logs）正常流量不写入访问日志
    mockLoggerService.logHttp.mockClear();
    const opsPanelUrls = [
      '/docs',
      '/docs/admin',
      '/docs/auth',
      '/docs-json',
      '/docs-admin-json',
      '/queues',
      '/logs',
      '/logs/api/files',
      '/logs/api/stream',
    ];
    for (const url of opsPanelUrls) {
      await onResponseHook({ ...completedReq, url }, mockReply);
    }
    expect(mockLoggerService.logHttp).not.toHaveBeenCalled();

    // 5. 运维面板的异常响应仍需记录（便于发现鉴权失败与面板异常）
    const unauthorizedReply = { ...mockReply, statusCode: 401 };
    await onResponseHook({ ...completedReq, url: '/logs' }, unauthorizedReply);
    expect(mockLoggerService.logHttp).toHaveBeenCalledWith(expect.objectContaining({ url: '/logs', statusCode: 401 }));

    // 6. 非运维面板路径（如 /api/v1/users 前缀相近路径）不受影响
    mockLoggerService.logHttp.mockClear();
    await onResponseHook({ ...completedReq, url: '/api/v1/docs-preview' }, mockReply);
    expect(mockLoggerService.logHttp).toHaveBeenCalledTimes(1);
  });
});

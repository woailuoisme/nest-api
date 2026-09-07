import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOG_VIEWER_PATH, setupLogViewer } from '@/setup/log-viewer';

describe('LogViewer Setup (log-viewer/index.ts)', () => {
  const getMock = vi.fn();
  const postMock = vi.fn();
  const deleteMock = vi.fn();

  const mockFastifyInstance = {
    get: getMock,
    post: postMock,
    delete: deleteMock,
  };

  const mockHttpAdapter = {
    getInstance: vi.fn().mockReturnValue(mockFastifyInstance),
  };

  const fakeApp = {
    getHttpAdapter: vi.fn().mockReturnValue(mockHttpAdapter),
  } as unknown as NestFastifyApplication;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('生产环境未配置访问凭据时应拒绝挂载且不注册任何路由', async () => {
    vi.stubEnv('APP_ENV', 'production');

    const returnedUrl = await setupLogViewer(fakeApp, 'http://localhost:4300');

    expect(returnedUrl).toBe('');
    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('应成功注册 /logs 主入口与 /logs/api/* 接口路由（包含 SSE stream），并返回访问 URL', async () => {
    const appUrl = 'http://localhost:4300';
    const returnedUrl = await setupLogViewer(fakeApp, appUrl);

    expect(returnedUrl).toBe(`${appUrl}${LOG_VIEWER_PATH}`);
    expect(getMock).toHaveBeenCalledWith(LOG_VIEWER_PATH, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/files`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/entries`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/stream`, expect.any(Function));
    expect(getMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/download`, expect.any(Function));
    expect(postMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/clear`, expect.any(Function));
    expect(deleteMock).toHaveBeenCalledWith(`${LOG_VIEWER_PATH}/api/files/:filename`, expect.any(Function));
  });

  it('GET /logs 路由应输出完整 HTML 视图', async () => {
    await setupLogViewer(fakeApp);

    const handlerCall = getMock.mock.calls.find((call) => call[0] === LOG_VIEWER_PATH);
    expect(handlerCall).toBeDefined();
    const handler = handlerCall![1];

    const sendMock = vi.fn();
    const typeMock = vi.fn().mockReturnValue({ send: sendMock });
    const replyMock = { type: typeMock };

    await handler({}, replyMock);

    expect(typeMock).toHaveBeenCalledWith('text/html; charset=utf-8');
    expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('Log Viewer'));
    expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('tailwindcss'));
    expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('alpinejs'));
    expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('toasts'));
    expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('confirmModal'));
  });
});

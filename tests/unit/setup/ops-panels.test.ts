import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupBullBoard } from '@/setup/bull-board';
import { setupLogViewer } from '@/setup/log-viewer';
import { registerOpsPanels } from '@/setup/ops-panels';
import { setupApiDocumentation } from '@/setup/swagger';

vi.mock('@/setup/bull-board', () => ({ setupBullBoard: vi.fn() }));
vi.mock('@/setup/log-viewer', () => ({ setupLogViewer: vi.fn() }));
vi.mock('@/setup/swagger', () => ({ setupApiDocumentation: vi.fn() }));

describe('registerOpsPanels', () => {
  const createApp = (configValues: Record<string, unknown>) =>
    ({
      get: vi.fn().mockReturnValue({
        get: (key: string) => configValues[key],
      }),
    }) as unknown as NestFastifyApplication;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('全部面板可挂载时应按 客户端文档 → 管理后台文档 → 队列看板 → 日志查看器 顺序返回并透传配置', async () => {
    const app = createApp({
      APP_URL: 'http://localhost:4300',
      SWAGGER_ENABLED: true,
      LOG_VIEWER_USER: 'lv-user',
      LOG_VIEWER_PASSWORD: 'lv-pass',
    });
    vi.mocked(setupBullBoard).mockResolvedValue('http://localhost:4300/queues');
    vi.mocked(setupLogViewer).mockResolvedValue('http://localhost:4300/logs');
    vi.mocked(setupApiDocumentation).mockResolvedValue({
      clientDocsUrl: 'http://localhost:4300/docs',
      adminDocsUrl: 'http://localhost:4300/docs/admin',
      authDocsUrl: 'http://localhost:4300/docs/auth',
    });

    const panels = await registerOpsPanels(app);

    expect(setupBullBoard).toHaveBeenCalledWith(app, 'http://localhost:4300');
    expect(setupLogViewer).toHaveBeenCalledWith(app, 'http://localhost:4300', {
      logViewerUser: 'lv-user',
      logViewerPassword: 'lv-pass',
    });
    expect(setupApiDocumentation).toHaveBeenCalledWith(app, 'http://localhost:4300');
    expect(panels).toEqual([
      { label: 'Scalar Client API Document', url: 'http://localhost:4300/docs' },
      { label: 'Scalar Admin API Document', url: 'http://localhost:4300/docs/admin' },
      { label: 'Scalar Auth API Document', url: 'http://localhost:4300/docs/auth' },
      { label: 'BullMQ Queue Dashboard', url: 'http://localhost:4300/queues' },
      { label: 'Web Log Viewer', url: 'http://localhost:4300/logs' },
    ]);
  });

  it('面板被门禁拒绝（返回空字符串）时应从结果中静默剔除', async () => {
    const app = createApp({ APP_URL: 'http://localhost:4300', SWAGGER_ENABLED: true });
    vi.mocked(setupBullBoard).mockResolvedValue('');
    vi.mocked(setupLogViewer).mockResolvedValue('');
    vi.mocked(setupApiDocumentation).mockResolvedValue({
      clientDocsUrl: 'http://localhost:4300/docs',
      adminDocsUrl: 'http://localhost:4300/docs/admin',
      authDocsUrl: 'http://localhost:4300/docs/auth',
    });

    const panels = await registerOpsPanels(app);

    expect(panels).toEqual([
      { label: 'Scalar Client API Document', url: 'http://localhost:4300/docs' },
      { label: 'Scalar Admin API Document', url: 'http://localhost:4300/docs/admin' },
      { label: 'Scalar Auth API Document', url: 'http://localhost:4300/docs/auth' },
    ]);
  });

  it('SWAGGER_ENABLED=false 时应跳过 API 文档挂载', async () => {
    const app = createApp({ APP_URL: 'http://localhost:4300', SWAGGER_ENABLED: false });
    vi.mocked(setupBullBoard).mockResolvedValue('http://localhost:4300/queues');
    vi.mocked(setupLogViewer).mockResolvedValue('http://localhost:4300/logs');

    const panels = await registerOpsPanels(app);

    expect(setupApiDocumentation).not.toHaveBeenCalled();
    expect(panels.map((panel) => panel.label)).toEqual(['BullMQ Queue Dashboard', 'Web Log Viewer']);
  });

  it('全部面板被拒挂时应返回空列表', async () => {
    const app = createApp({ APP_URL: 'http://localhost:4300', SWAGGER_ENABLED: false });
    vi.mocked(setupBullBoard).mockResolvedValue('');
    vi.mocked(setupLogViewer).mockResolvedValue('');

    const panels = await registerOpsPanels(app);

    expect(panels).toEqual([]);
    expect(app.get).toHaveBeenCalledWith(ConfigService);
  });
});

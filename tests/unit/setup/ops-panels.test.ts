import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerOpsPanels } from '@/setup/ops-panels';
import { setupApiDocumentation } from '@/setup/swagger';

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

  it('SWAGGER_ENABLED=true 时应按 客户端文档 → 管理后台文档 → 认证文档 顺序返回并透传配置', async () => {
    const app = createApp({
      APP_URL: 'http://localhost:4300',
      SWAGGER_ENABLED: true,
    });
    vi.mocked(setupApiDocumentation).mockResolvedValue({
      clientDocsUrl: 'http://localhost:4300/docs',
      adminDocsUrl: 'http://localhost:4300/docs/admin',
      authDocsUrl: 'http://localhost:4300/docs/auth',
    });

    const panels = await registerOpsPanels(app);

    expect(setupApiDocumentation).toHaveBeenCalledWith(app, 'http://localhost:4300');
    expect(panels).toEqual([
      { label: 'Docs', url: 'http://localhost:4300/docs' },
      { label: 'Admin', url: 'http://localhost:4300/docs/admin' },
      { label: 'Auth', url: 'http://localhost:4300/docs/auth' },
    ]);
  });

  it('SWAGGER_ENABLED=false 时应跳过 API 文档挂载并返回空列表', async () => {
    const app = createApp({ APP_URL: 'http://localhost:4300', SWAGGER_ENABLED: false });

    const panels = await registerOpsPanels(app);

    expect(setupApiDocumentation).not.toHaveBeenCalled();
    expect(panels).toEqual([]);
    expect(app.get).toHaveBeenCalledWith(ConfigService);
  });
});

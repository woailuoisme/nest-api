import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupBullBoard } from '@/setup/bull-board';

describe('setupBullBoard 生产环境访问门禁', () => {
  const createApp = (values: Record<string, unknown>) =>
    ({
      get: vi.fn().mockReturnValue({
        get: (key: string) => values[key],
      }),
    }) as unknown as NestFastifyApplication;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('生产环境未配置访问凭据时应拒绝挂载且不触碰任何队列资源', async () => {
    vi.stubEnv('APP_ENV', 'production');
    const app = createApp({});

    await expect(setupBullBoard(app, 'http://localhost:4300')).resolves.toBe('');
    expect(app.get).toHaveBeenCalledTimes(1);
    expect(app.get).toHaveBeenCalledWith(ConfigService);
  });

  it('生产环境仅配置部分凭据（缺少密码）时同样应拒绝挂载', async () => {
    vi.stubEnv('APP_ENV', 'production');
    const app = createApp({ BULL_BOARD_USER: 'ops' });

    await expect(setupBullBoard(app, 'http://localhost:4300')).resolves.toBe('');
    expect(app.get).toHaveBeenCalledTimes(1);
  });
});

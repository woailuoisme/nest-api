import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { DrizzleService } from '@/database/drizzle/drizzle.service';

describe('DrizzleService', () => {
  it('应正确初始化连接池并在 onApplicationShutdown 时释放连接', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'DB_URL') return 'postgresql://test:test@localhost:5432/test_db';
        if (key === 'DATABASE_POOL_MAX') return 10;
        if (key === 'DATABASE_POOL_IDLE_TIMEOUT_MS') return 10000;
        if (key === 'DATABASE_POOL_CONNECTION_TIMEOUT_MS') return 5000;
        return undefined;
      }),
    } as unknown as ConfigService<any, true>;

    const service = new DrizzleService(mockConfig);
    expect(service.db).toBeDefined();

    // 验证 onApplicationShutdown 调用 client.end()
    const clientEndSpy = vi.spyOn((service as any).client, 'end').mockResolvedValue(undefined as never);
    await service.onApplicationShutdown();

    expect(clientEndSpy).toHaveBeenCalledTimes(1);
  });
});

import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { CacheModule } from '@/common/cache';
import { REDIS_CLIENT } from '@/database/redis.module';

describe('CacheModule 缓存模块装配与 KeyvCacheableMemory 集成测试', () => {
  it('应成功注册 CacheModule 并注入 CACHE_MANAGER，支持原生 keyv multi-tier 读写', async () => {
    // 提供假 Redis 客户端以通过依赖检查，聚焦测试 L1 KeyvCacheableMemory 与 CacheModule
    const mockRedis = {
      publish: () => Promise.resolve(1),
      status: 'ready',
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              REDIS_URL: '', // 无真实 Redis 时走单 L1 store
              CACHE_L1_TTL_MS: 5000,
            }),
          ],
        }),
        CacheModule,
      ],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(mockRedis)
      .compile();

    const cache = moduleRef.get<Cache>(CACHE_MANAGER);
    expect(cache).toBeDefined();

    // 读写操作验证
    await cache.set('test:key', { foo: 'bar' }, 1000);
    const value = await cache.get<{ foo: string }>('test:key');
    expect(value).toEqual({ foo: 'bar' });

    await cache.del('test:key');
    const deletedValue = await cache.get('test:key');
    expect(deletedValue).toBeUndefined();
  });

  it('当配置了 REDIS_URL 时应装配 L1+L2 双层 Keyv 存储，且 Redis 离线时非阻塞降级不中断 L1 缓存读写', async () => {
    const mockRedis = { publish: () => Promise.resolve(1), status: 'ready' };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              REDIS_URL: 'redis://127.0.0.1:65534/0', // 指向不可达端口模拟 Redis 故障
              CACHE_L1_TTL_MS: 5000,
            }),
          ],
        }),
        CacheModule,
      ],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(mockRedis)
      .compile();

    const cache = moduleRef.get<Cache>(CACHE_MANAGER);
    expect(cache).toBeDefined();

    // 验证写入和读取依然成功执行（由 L1 承接，L2 错误被非阻塞忽略）
    await cache.set('multi-tier:key', 'safe_data', 1000);
    const value = await cache.get<string>('multi-tier:key');
    expect(value).toBe('safe_data');
  });
});

import { createKeyvNonBlocking } from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeyvCacheableMemory } from 'cacheable';
import Keyv from 'keyv';

import type { EnvConfig } from '@/config/env.validation';
import { RedisModule } from '@/database/redis.module';

import { CACHE_L1_STORE, DEFAULT_CACHE_TTL_MS, DEFAULT_L1_TTL_MS } from './cache.constants.js';
import { CacheService } from './cache.service.js';

/**
 * 适配 @nestjs/cache-manager 的 isKeyvInstance 属性特征判定
 *
 * @nestjs/cache-manager 内部通过 `'opts' in store` 判定 Keyv 实例，
 * 避免 Keyv v5+ 实例因无 opts 属性而被再次以 new Keyv({ store }) 重复冗余包装。
 */
function markKeyvInstance<T extends Keyv>(store: T): T {
  if (!('opts' in store)) {
    Object.defineProperty(store, 'opts', { value: {}, enumerable: false, writable: true });
  }
  return store;
}

/**
 * 本地进程内 L1 Keyv 内存实例（有界 LRU 内存存储，限制最大 5000 条条目防泄露）
 *
 * 设为当前进程单例，供底层 NestCacheModule 与 CacheService 失效监听器共享同一对象引用。
 */
export const l1MemoryStore = markKeyvInstance(
  new Keyv({
    store: new KeyvCacheableMemory({ ttl: DEFAULT_L1_TTL_MS, lruSize: 5000 }),
  }),
);

const l1StoreProvider = {
  provide: CACHE_L1_STORE,
  useValue: l1MemoryStore,
};

/**
 * 全局统一企业级缓存模块
 *
 * 职责：
 * 1. 异步装配 @nestjs/cache-manager，与全局 CacheInterceptor 共享统一上下文；
 * 2. 装配 L1 本地进程内有界内存 (KeyvCacheableMemory) + L2 分布式 Redis (createKeyvNonBlocking) 双层存储；
 * 3. 依据 REDIS_URL 配置自动化连接本地 Valkey / Redis 服务，并启用非阻塞降级保障（Redis 抖动时不阻塞 L1 命中）；
 * 4. 导出 CacheService 业务高可用门面与底层 CACHE_MANAGER。
 */
@Global()
@Module({
  imports: [
    RedisModule,
    NestCacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => {
        const redisUrl = configService.get('REDIS_URL');
        const stores: Keyv[] = [l1MemoryStore];

        if (redisUrl) {
          const l2RedisStore = markKeyvInstance(createKeyvNonBlocking(redisUrl));
          l2RedisStore.on('error', () => {});
          (l2RedisStore.store as { on?: (event: string, fn: () => void) => void })?.on?.('error', () => {});
          stores.push(l2RedisStore);
        }

        return {
          stores,
          ttl: DEFAULT_CACHE_TTL_MS,
        };
      },
    }),
  ],
  providers: [l1StoreProvider, CacheService],
  exports: [NestCacheModule, l1StoreProvider, CacheService],
})
export class CacheModule {}

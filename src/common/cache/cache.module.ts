import KeyvRedis from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import type { EnvConfig } from '@/config/env.validation';
import { RedisModule } from '@/database/redis.module';
import { CACHE_L1_STORE, DEFAULT_CACHE_TTL_MS, DEFAULT_L1_TTL_MS } from './cache.constants.js';
import { CacheService } from './cache.service.js';

/**
 * 本地进程内 L1 Keyv 内存实例
 *
 * 设为当前进程单例，供底层 NestCacheModule 与 CacheService 失效监听器共享同一对象引用。
 */
export const l1MemoryStore = new Keyv({ ttl: DEFAULT_L1_TTL_MS });

const l1StoreProvider = {
  provide: CACHE_L1_STORE,
  useValue: l1MemoryStore,
};

/**
 * 全局统一企业级缓存模块
 *
 * 职责：
 * 1. 异步装配 @nestjs/cache-manager，与全局 CacheInterceptor 共享统一上下文；
 * 2. 装配 L1 本地进程内内存 (Keyv Map) + L2 分布式 Redis (KeyvRedis) 双层存储；
 * 3. 依据 REDIS_URL 配置自动化连接本地 Valkey / Redis 服务；
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
        const l2RedisStore = new Keyv({
          store: new KeyvRedis(redisUrl),
          ttl: DEFAULT_CACHE_TTL_MS,
        });

        return {
          stores: [l1MemoryStore, l2RedisStore],
          ttl: DEFAULT_CACHE_TTL_MS,
        };
      },
    }),
  ],
  providers: [l1StoreProvider, CacheService],
  exports: [NestCacheModule, l1StoreProvider, CacheService],
})
export class CacheModule {}

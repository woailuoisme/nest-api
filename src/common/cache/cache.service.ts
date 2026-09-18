import { randomUUID } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { isNil } from 'es-toolkit';
import type Redis from 'ioredis';
import type Keyv from 'keyv';
import { INJECTION_TOKENS } from '@/common/constants/app.constants';
import {
  CACHE_INVALIDATE_CHANNEL,
  CACHE_L1_STORE,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_NULL_CACHE_TTL_MS,
  NULL_CACHE_SENTINEL,
} from './cache.constants.js';
import type { CacheInvalidateMessage, RememberOptions } from './cache.interfaces.js';

/**
 * 计算附加 Jitter 随机抖动后的实际生存时间（防雪崩）
 *
 * @param baseTtlMs 基准 TTL (毫秒)
 * @param ratio 抖动比例，默认 0.1 (±10%)
 */
export function calculateJitterTtl(baseTtlMs: number, ratio = 0.1): number {
  if (ratio <= 0) {
    return baseTtlMs;
  }
  const min = baseTtlMs * (1 - ratio);
  const max = baseTtlMs * (1 + ratio);
  return Math.round(min + Math.random() * (max - min));
}

/**
 * 企业级统一缓存门面服务 (CacheService)
 *
 * 核心特性：
 * 1. 深度对齐 NestJS 官方 @nestjs/cache-manager，与全局 CacheInterceptor 共享同一底层存储抽象；
 * 2. L1 内存 + L2 Redis 双层穿透缓存；
 * 3. 生产级跨 Pod / 实例的 Redis Pub/Sub 缓存主动失效广播；
 * 4. remember() 高并发三防体系：Singleflight 并发互斥回源（防击穿）、空值短期占位缓存（防穿透）、TTL 随机 Jitter（防雪崩）。
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  /** 当前进程实例唯一标识，用于跨节点 Pub/Sub 广播时自我过滤 */
  public readonly instanceId = randomUUID();

  /** Singleflight 飞行中互斥请求池，防止同一 Key 高并发打穿底层数据库 */
  private readonly inFlightRequests = new Map<string, Promise<unknown>>();

  /** 专用于 Redis Pub/Sub 监听的独立 ioredis 连接副本 */
  private subClient?: Redis;

  /** 是否已就绪监听广播 */
  private isSubscribed = false;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(INJECTION_TOKENS.REDIS_CLIENT) private readonly redisClient: Redis,
    @Optional() @Inject(CACHE_L1_STORE) private readonly l1Store?: Keyv,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initPubSubSubscriber();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subClient) {
      try {
        await this.subClient.quit();
      } catch {
        this.subClient.disconnect();
      }
      this.subClient = undefined;
      this.isSubscribed = false;
    }
  }

  /**
   * 初始化 Redis Pub/Sub 广播监听连接，实现跨节点毫秒级 L1 缓存失效同步
   */
  private async initPubSubSubscriber(): Promise<void> {
    try {
      // ioredis 要求订阅连接独立于常规命令连接
      this.subClient = this.redisClient.duplicate();

      await this.subClient.subscribe(CACHE_INVALIDATE_CHANNEL);
      this.isSubscribed = true;

      this.subClient.on('message', (channel: string, message: string) => {
        if (channel !== CACHE_INVALIDATE_CHANNEL) {
          return;
        }

        try {
          const parsed: CacheInvalidateMessage = JSON.parse(message);

          // 忽略本实例主动发布的广播，防止自环重复驱逐
          if (parsed.originInstanceId === this.instanceId) {
            return;
          }

          this.handleRemoteInvalidation(parsed);
        } catch (error) {
          this.logger.warn(`Failed to parse cache invalidation message: ${String(error)}`);
        }
      });

      this.logger.debug(`Cache Pub/Sub subscriber listening on channel [${CACHE_INVALIDATE_CHANNEL}]`);
    } catch (error) {
      this.logger.error(`Failed to initialize cache Pub/Sub subscriber: ${String(error)}`);
    }
  }

  /**
   * 响应来自远端节点的失效广播，清除本地 L1 内存
   */
  private handleRemoteInvalidation(msg: CacheInvalidateMessage): void {
    if (msg.key === '*') {
      this.l1Store?.clear();
      this.logger.debug(`Evicted entire local L1 cache triggered by instance [${msg.originInstanceId}]`);
      return;
    }

    if (msg.key) {
      this.l1Store?.delete(msg.key);
      this.logger.debug(`Evicted local L1 key [${msg.key}] triggered by instance [${msg.originInstanceId}]`);
    }
  }

  /**
   * 获取缓存项
   *
   * @param key 缓存键
   * @returns 缓存命中值；若命中防穿透空值哨兵则返回 null；未命中返回 undefined
   */
  async get<T>(key: string): Promise<T | null | undefined> {
    const raw = await this.cacheManager.get<T | string>(key);

    // 未命中 → undefined；命中防穿透空值哨兵 → null
    if (isNil(raw)) {
      return undefined;
    }

    return raw === NULL_CACHE_SENTINEL ? null : (raw as T);
  }

  /**
   * 写入缓存项
   *
   * @param key 缓存键
   * @param value 缓存值
   * @param ttlMs 生存时间 (毫秒)，默认使用 DEFAULT_CACHE_TTL_MS (60s)
   */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? DEFAULT_CACHE_TTL_MS;
    await this.cacheManager.set(key, value, ttl);
  }

  /**
   * 删除指定缓存项，并向集群广播失效事件
   *
   * @param key 缓存键
   */
  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
    if (this.l1Store) {
      await this.l1Store.delete(key);
    }
    await this.broadcastInvalidation(key);
  }

  /**
   * 清空全部缓存，并向集群广播全量失效事件
   */
  async reset(): Promise<void> {
    if (this.l1Store) {
      await this.l1Store.clear();
    }
    if (typeof this.cacheManager.clear === 'function') {
      await this.cacheManager.clear();
    }
    await this.broadcastInvalidation('*');
  }

  /**
   * 获取当前实例的集群失效广播监听状态
   */
  get isSubscribedToCluster(): boolean {
    return this.isSubscribed;
  }

  /**
   * 高并发安全读写回源函数 (remember)
   *
   * 内置工业级三大防护：
   * 1. Singleflight 并发互斥：同一时刻数万并发访问未命中 Key，底层 fetcher() 仅执行 1 次；
   * 2. 空值防穿透：当 fetcher() 返回 null/undefined 时，以短 TTL 缓存空值哨兵，防止恶意扫描击垮数据库；
   * 3. TTL Jitter 防雪崩：在设定 TTL 基础上附加 ±10% 随机时间抖动，避免大批量数据同时过期引发雪崩。
   *
   * @param key 缓存键名
   * @param ttlMs 回源成功后的基准 TTL（毫秒）
   * @param fetcher 回源计算函数
   * @param options 防护选项（jitterRatio, cacheNull, nullTtlMs 等）
   */
  async remember<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, options?: RememberOptions): Promise<T> {
    // 1. 优先读取既有缓存
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached as T;
    }

    // 2. Singleflight 内存并发互斥检查
    const inFlight = this.inFlightRequests.get(key);
    if (inFlight) {
      return (await inFlight) as T;
    }

    // 3. 构造互斥执行 Promise
    const executionPromise = (async (): Promise<T> => {
      try {
        // 双重检查防并发竞争 (Double Check)
        const doubleChecked = await this.get<T>(key);
        if (doubleChecked !== undefined) {
          return doubleChecked as T;
        }

        const freshValue = await fetcher();

        // 4. 空值防穿透处理
        if (isNil(freshValue)) {
          const shouldCacheNull = options?.cacheNull ?? true;
          if (shouldCacheNull) {
            const nullTtl = options?.nullTtlMs ?? DEFAULT_NULL_CACHE_TTL_MS;
            await this.cacheManager.set(key, NULL_CACHE_SENTINEL, nullTtl);
          }
          return freshValue;
        }

        // 5. 防雪崩 Jitter TTL 计算与落盘
        const jitterRatio = options?.jitterRatio ?? 0.1;
        const actualTtl = calculateJitterTtl(ttlMs, jitterRatio);

        await this.set(key, freshValue, actualTtl);

        return freshValue;
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, executionPromise);

    return executionPromise;
  }

  /**
   * 向集群各节点广播缓存失效通知
   */
  public async broadcastInvalidation(key: string): Promise<void> {
    try {
      const message: CacheInvalidateMessage = {
        originInstanceId: this.instanceId,
        key,
        timestamp: Date.now(),
      };

      await this.redisClient.publish(CACHE_INVALIDATE_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(`Failed to broadcast cache invalidation for key [${key}]: ${String(error)}`);
    }
  }

  /**
   * 提供对底层 cache-manager 原始门面的直接访问
   */
  getRawManager(): Cache {
    return this.cacheManager;
  }

  /**
   * 提供对底层 L1 内存存储 Keyv 实例的直接访问（用于测试或自省）
   */
  getL1Store(): Keyv | undefined {
    return this.l1Store;
  }
}

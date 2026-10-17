import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { compact, isNil } from 'es-toolkit';
import type Redis from 'ioredis';

import { INJECTION_TOKENS } from '@/common/constants/app.constants';

import { UNLOCK_LUA_SCRIPT } from './lua-scripts';

const REDIS_CLIENT = INJECTION_TOKENS.REDIS_CLIENT;

/**
 * 深度 Redis 服务 — 封装高杠杆原子操作：
 * 1. `withLock`: 分布式排他锁（SET NX PX + Lua 原子释放），支持多副本集群并发互斥调度与防重；
 * 2. `remember`: 自动缓存回源与 JSON 序列化；
 * 3. 基础缓存与键值操作。
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** 获取原始 ioredis 客户端实例 */
  getClient(): Redis {
    return this.client;
  }

  /**
   * 格式化统一的 Redis 命名空间键名
   *
   * @example redis.key('user', 123) // -> 'user:123'
   * @example redis.key('token', 'refresh', userId) // -> 'token:refresh:1'
   */
  key(namespace: string, ...parts: (string | number)[]): string {
    const segments = compact([namespace, ...parts].map(String));
    return segments.join(':');
  }

  /**
   * 分布式锁 — 支持高并发集群环境下的安全互斥执行。
   *
   * 采用 Redis 原生 SET NX PX + Lua 原子安全释放，杜绝锁被其他实例意外释放的问题。
   *
   * @param key 锁键名（如 'schedule:token-cleanup'）
   * @param ttlMs 锁超时时间（毫秒，防止实例崩溃导致死锁）
   * @param fn 获得锁后执行的业务逻辑
   * @returns 若成功抢占锁并执行，返回业务结果；若未能抢占到锁，返回 null
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const lockToken = randomUUID();
    const lockKey = key.startsWith('lock:') ? key : `lock:${key}`;

    const acquired = await this.client.set(lockKey, lockToken, 'PX', ttlMs, 'NX');
    if (!acquired) {
      this.logger.debug(`未能获取分布式锁 [${lockKey}]，跳过执行`);
      return null;
    }

    try {
      return await fn();
    } finally {
      try {
        await this.client.eval(UNLOCK_LUA_SCRIPT, 1, lockKey, lockToken);
      } catch (err) {
        this.logger.warn(`释放分布式锁 [${lockKey}] 失败: ${String(err)}`);
      }
    }
  }

  /**
   * 自动缓存读写 — 缓存穿透保护与回源写回。
   *
   * @param key 缓存键
   * @param ttlSeconds 缓存有效期（秒）
   * @param fetcher 缓存未命中时的回源回调
   */
  async remember<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.client.get(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // JSON 解析失败则回源
      }
    }

    const fresh = await fetcher();
    if (!isNil(fresh)) {
      await this.client.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
    }
    return fresh;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (ttlSeconds) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}

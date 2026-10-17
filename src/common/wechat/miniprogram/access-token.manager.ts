import { setTimeout as sleep } from 'node:timers/promises';

import type { Logger } from '@nestjs/common';

import type { MiniprogramTokenCache, MiniprogramTokenFetcher } from './drivers/miniprogram-driver.interface';
import {
  MINIPROGRAM_ACCESS_TOKEN_CACHE_NAMESPACE,
  MINIPROGRAM_ACCESS_TOKEN_LOCK_TTL_MS,
  MINIPROGRAM_ACCESS_TOKEN_LOCK_WAIT_MS,
  MINIPROGRAM_ACCESS_TOKEN_MIN_CACHE_SECONDS,
  MINIPROGRAM_ACCESS_TOKEN_SAFETY_WINDOW_SECONDS,
} from './miniprogram.constants';
import { MiniprogramException } from './miniprogram.exception';

/** 缓存中的凭证条目 */
interface CachedAccessToken {
  accessToken: string;
  /** 凭证真实过期时刻（epoch 毫秒） */
  expiresAt: number;
}

/** 构造参数 */
export interface AccessTokenManagerOptions {
  /** 小程序 appid，用于隔离缓存键，支持多小程序共用一个 Redis */
  appid: string;
  /** 底层获取能力（由驱动提供，避免本类反向依赖驱动） */
  fetcher: MiniprogramTokenFetcher;
  /** 缓存实现，缺省时退化为进程内内存缓存 */
  cache?: MiniprogramTokenCache;
  logger: Logger;
  /** 提前续期窗口（秒） */
  safetyWindowSeconds?: number;
}

/**
 * 进程内内存缓存
 *
 * 用于单元测试与无 Redis 场景：因 `stable_token` 普通模式幂等（有效期内重复调用返回同一凭证），
 * 多实例各持一份也不会互相顶掉，仅在实例重启后需要重新获取。
 */
export class MemoryMiniprogramTokenCache implements MiniprogramTokenCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }
}

/**
 * access_token 管理器
 *
 * 官方 `stable_token` 普通模式（`force_refresh` 缺省）在有效期内**重复调用返回同一凭证**，
 * 且与旧的 `getAccessToken` 互相隔离，因此多实例部署不再存在互相顶掉凭证的问题。
 * 本管理器在此之上叠加两层优化：
 *
 * 1. **共享缓存**（Redis，键含 appid）：避免每个业务请求都产生一次到微信的网络往返；
 * 2. **分布式刷新锁**：防止多实例在缓存失效瞬间同时回源（击穿）。
 *
 * 强制刷新（`refreshToken`）仅在收到凭证失效类错误码（42001 / 40001 / 40014 / 41001）后触发一次；
 * 官方对强刷有「每天 20 次且间隔 30 秒」的硬限制，故绝不可用于常规续期。
 */
export class AccessTokenManager {
  private readonly appid: string;
  private readonly fetcher: MiniprogramTokenFetcher;
  private readonly cache: MiniprogramTokenCache;
  private readonly logger: Logger;
  private readonly safetyWindowMs: number;
  private readonly cacheKey: string;
  private readonly lockKey: string;

  constructor(options: AccessTokenManagerOptions) {
    this.appid = options.appid;
    this.fetcher = options.fetcher;
    this.cache = options.cache ?? new MemoryMiniprogramTokenCache();
    this.logger = options.logger;
    this.safetyWindowMs = (options.safetyWindowSeconds ?? MINIPROGRAM_ACCESS_TOKEN_SAFETY_WINDOW_SECONDS) * 1000;
    this.cacheKey = `${MINIPROGRAM_ACCESS_TOKEN_CACHE_NAMESPACE}:${options.appid}`;
    this.lockKey = `wechat:miniprogram:access_token:refresh:${options.appid}`;
  }

  /** 获取当前有效的 access_token（缓存命中直接返回，临近失效时续期） */
  async getToken(): Promise<string> {
    const cached = await this.readValidToken();
    if (cached) {
      return cached;
    }
    return this.fetchWithLock(false);
  }

  /** 强制刷新 access_token（仅用于凭证失效后的重试） */
  async refreshToken(): Promise<string> {
    this.logger.warn('强制刷新微信小程序 access_token（通常由 42001/40001 凭证失效触发）');
    return this.fetchWithLock(true);
  }

  // ── 私有 ────────────────────────────────────────────────────────────

  /** 读取缓存中仍在「真实有效期 - 续期窗口」之外的凭证 */
  private async readValidToken(): Promise<string | null> {
    let raw: string | null;
    try {
      raw = await this.cache.get(this.cacheKey);
    } catch (error) {
      // 缓存不可用不应阻断业务：降级为直接回源
      this.logger.warn(`读取 access_token 缓存失败，将直接回源：${(error as Error).message}`);
      return null;
    }
    if (!raw) {
      return null;
    }

    try {
      const entry = JSON.parse(raw) as CachedAccessToken;
      if (typeof entry.accessToken !== 'string' || typeof entry.expiresAt !== 'number') {
        return null;
      }
      return entry.expiresAt - this.safetyWindowMs > Date.now() ? entry.accessToken : null;
    } catch {
      this.logger.warn('access_token 缓存内容损坏，将重新获取');
      return null;
    }
  }

  /** 抢占刷新锁后回源；未抢到锁时等待并复用持锁者的刷新结果 */
  private async fetchWithLock(force: boolean): Promise<string> {
    const task = async (): Promise<string> => {
      if (!force) {
        // 双重检查：等待锁期间凭证可能已被其他实例刷新
        const cached = await this.readValidToken();
        if (cached) {
          return cached;
        }
      }
      return this.fetchAndStore(force);
    };

    const cache = this.cache;
    if (!cache.withLock) {
      return task();
    }

    try {
      const acquired = await cache.withLock(this.lockKey, MINIPROGRAM_ACCESS_TOKEN_LOCK_TTL_MS, task);
      if (acquired !== null) {
        return acquired;
      }
    } catch (error) {
      // 锁不可用（如 Redis 抖动）不应阻断凭证获取：stable_token 幂等，直接回源即可
      this.logger.warn(`access_token 刷新锁不可用，改为直接回源：${(error as Error).message}`);
      return task();
    }

    // 未抢到锁：等待持锁实例写入缓存后回读，避免重复回源；持锁者失败或耗尽 TTL 时兜底回源
    await sleep(MINIPROGRAM_ACCESS_TOKEN_LOCK_WAIT_MS);
    return (await this.readValidToken()) ?? this.fetchAndStore(false);
  }

  /** 调用底层接口获取凭证并写入缓存 */
  private async fetchAndStore(force: boolean): Promise<string> {
    const token = await this.fetcher(force);
    if (!token.accessToken) {
      throw new MiniprogramException('MINIPROGRAM_TOKEN_MISSING', '获取 access_token 的应答中缺少 access_token 字段');
    }

    // 缓存时长取「真实有效期 - 续期窗口」，并保底最短 TTL，避免在凭证轮换边界上高频回源
    const ttlSeconds = Math.max(
      token.expiresIn - this.safetyWindowMs / 1000,
      MINIPROGRAM_ACCESS_TOKEN_MIN_CACHE_SECONDS,
    );
    const entry: CachedAccessToken = {
      accessToken: token.accessToken,
      expiresAt: Date.now() + token.expiresIn * 1000,
    };

    try {
      await this.cache.set(this.cacheKey, JSON.stringify(entry), ttlSeconds);
    } catch (error) {
      // 写缓存失败仅影响后续请求的性能，不影响本次调用
      this.logger.warn(`写入 access_token 缓存失败：${(error as Error).message}`);
    }

    this.logger.debug(`已获取微信小程序 access_token（appid=${this.appid}，剩余有效期=${token.expiresIn}s）`);
    return token.accessToken;
  }
}

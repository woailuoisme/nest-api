import { Inject, Optional } from '@nestjs/common';
import { type Cache, createCache } from 'cache-manager';

import type { ResilienceModuleOptions } from './interfaces/index.js';
import { MODULE_OPTIONS_TOKEN } from './resilience.module-definition.js';

export class ResilienceStatesManager {
  private static readonly PREFIX = 'nestjs-resilience/';

  private static instance: ResilienceStatesManager;

  public static getInstance(): ResilienceStatesManager {
    if (!ResilienceStatesManager.instance) {
      return new ResilienceStatesManager();
    }

    return ResilienceStatesManager.instance;
  }

  public static async reset(): Promise<boolean> {
    if (ResilienceStatesManager.instance) {
      return ResilienceStatesManager.instance.reset();
    }
    return true;
  }

  public readonly cache: Cache;

  public constructor(
    @Optional()
    @Inject(MODULE_OPTIONS_TOKEN)
    public readonly options?: ResilienceModuleOptions,
  ) {
    ResilienceStatesManager.instance = this;
    const stores = options?.stores ?? [];

    if (options?.store) {
      stores.push(options.store);
    }

    // keyv 双副本（cache-manager 锁 keyv@5，项目用 keyv@6），运行时 API 兼容，仅类型收敛
    this.cache = createCache({ stores: stores as never });
  }

  public async del(key: string): Promise<boolean> {
    return this.cache.del(ResilienceStatesManager.PREFIX + key);
  }

  public async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get<T>(ResilienceStatesManager.PREFIX + key);
  }

  public async reset(): Promise<boolean> {
    return this.cache.clear();
  }

  public async set<T>(key: string, value: T, ttl?: number): Promise<T> {
    return this.cache.set(ResilienceStatesManager.PREFIX + key, value, ttl);
  }

  public async wrap<T>(key: string, fn: () => Promise<T>, ttl?: number | ((value: T) => number)): Promise<T> {
    const fullKey = ResilienceStatesManager.PREFIX + key;

    return this.cache.wrap(fullKey, fn, ttl);
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';

import { INJECTION_TOKENS } from '@/common/constants/app.constants';
import { THROTTLE_INCREMENT_LUA_SCRIPT } from '@/database/lua-scripts';

/**
 * 计数记录类型由接口签名推导
 *
 * `@nestjs/throttler` 未从包根导出 `ThrottlerStorageRecord`（该接口仅在内部深路径声明），
 * 由 `ThrottlerStorage['increment']` 推导可避免依赖其 dist 目录结构。
 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** 降级告警最小间隔（毫秒）：Redis 抖动时避免逐请求刷日志 */
const DEGRADED_WARN_INTERVAL_MS = 30_000;

/**
 * 单次限流 Redis 调用的时间上界（毫秒）
 *
 * 就绪状态下的 EVALSHA 通常 <5ms，100ms 已留出约 20 倍余量；超出即视为依赖抖动并降级，
 * 避免单请求耗时被依赖拖到秒级（守卫阶段不受 `HTTP_TIMEOUT_MS` 约束，必须自带上界）。
 */
const THROTTLE_REDIS_TIMEOUT_MS = 100;

/** `defineCommand` 动态挂载的脚本方法（返回 `[命中数, 窗口剩余毫秒, 是否封禁, 封禁剩余毫秒]`） */
type ThrottleScriptClient = Redis & {
  throttleIncrement(
    counterKey: string,
    blockKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<number[]>;
};

/**
 * Redis 共享限流存储 (RedisThrottlerStorage)
 *
 * 解决进程内存储在多副本部署下的语义缺陷：每个 Pod 各自计数会让 `THROTTLE_LIMIT` 实际放大 N 倍。
 * 本实现以单条 Lua 脚本在 Redis 侧原子完成计数与封禁判定，使额度跨实例真实生效。
 *
 * **可用性策略（两层，缺一不可）**：
 * 1. 语义降级 — 限流属保护能力而非业务正确性门槛，Redis 故障时回退进程内计数并限频告警，
 *    绝不让限流基础设施抖动演化为请求失败（5xx）；
 * 2. 时间上界 — 客户端未就绪时立即走降级、就绪时给单次调用设置超时上界。缺少这一层会造成
 *    「功能正确但请求被拖慢数秒」：ioredis 默认 `enableOfflineQueue: true`，断连期间发出的命令会
 *    排进离线队列并等待整个重连周期才失败（实测单次 >7s，连续请求可达 20s）。
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  private readonly script: ThrottleScriptClient;

  /** 是否处于降级状态（用于恢复时输出一次性 info 日志） */
  private degraded = false;

  /** 上次降级告警时间戳（毫秒），用于告警限频 */
  private lastWarnAt = 0;

  constructor(
    @Inject(INJECTION_TOKENS.REDIS_CLIENT) redisClient: Redis,
    /** Redis 不可用时的进程内兜底存储（由容器托管生命周期） */
    private readonly fallback: ThrottlerStorageService,
  ) {
    // EVALSHA 优先 + NOSCRIPT 自动回退 EVAL：避免每次请求都重传脚本体（脚本源见 src/database/lua-scripts.ts）
    redisClient.defineCommand('throttleIncrement', { numberOfKeys: 2, lua: THROTTLE_INCREMENT_LUA_SCRIPT });
    this.script = redisClient as ThrottleScriptClient;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // 键空间与业务缓存隔离。传入的 key 由 @nestjs/throttler 默认 generateKey 生成
    // （class + handler + 名称 + 客户端标识的 SHA-256 摘要，无明文个人信息），仍属按客户端区分的标识，故不写入日志。
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    if (!this.canServeImmediately()) {
      this.warnDegraded(new Error(`Redis 客户端未就绪（status=${this.script.status}）`));
      return this.fallback.increment(counterKey, ttl, limit, blockDuration, throttlerName);
    }

    try {
      const [hits, windowTtlMs, blockedFlag, blockTtlMs] = await this.callScript(
        counterKey,
        blockKey,
        ttl,
        limit,
        blockDuration,
      );

      this.markRecovered();

      return {
        totalHits: Number(hits),
        // 与 @nestjs/throttler 内置实现一致：对外暴露的剩余时间单位为秒（供 Retry-After / X-RateLimit-Reset 使用）
        timeToExpire: Math.ceil(Number(windowTtlMs) / 1000),
        isBlocked: Number(blockedFlag) === 1,
        timeToBlockExpire: Math.ceil(Number(blockTtlMs) / 1000),
      };
    } catch (error) {
      this.warnDegraded(error);
      return this.fallback.increment(counterKey, ttl, limit, blockDuration, throttlerName);
    }
  }

  /**
   * 客户端是否可在当前状态立即服务命令
   *
   * `'wait'` 是 `lazyConnect: true` 的冷启动状态 —— 此时发出命令才会触发建连，因此必须放行；
   * 若把它一并视为未就绪，客户端将永远不会建立首次连接（永久降级）。
   * `'reconnecting' / 'close' / 'end'` 等状态则直接降级，避免命令排进离线队列等待整个重连周期。
   */
  private canServeImmediately(): boolean {
    return this.script.status === 'ready' || this.script.status === 'wait';
  }

  /**
   * 带时间上界地调用计数脚本
   *
   * 超时后放弃等待（ioredis 侧该命令仍可能完成，最多使计数多算一次，对限流语义无害），
   * 已 settle 的 Promise.race 会吸收被放弃分支的后续结果，不会产生 unhandledRejection。
   */
  private async callScript(
    counterKey: string,
    blockKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<number[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.script.throttleIncrement(counterKey, blockKey, ttl, limit, blockDuration),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`限流共享存储响应超时（>${THROTTLE_REDIS_TIMEOUT_MS}ms）`)),
            THROTTLE_REDIS_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** 降级告警（限频）：故障期间不逐请求刷日志，恢复后输出一次性 info */
  private warnDegraded(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt >= DEGRADED_WARN_INTERVAL_MS) {
      this.lastWarnAt = now;
      this.logger.warn(
        `限流共享存储不可用，已降级为进程内计数（多副本额度将各自独立）: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.degraded = true;
  }

  /** 恢复正常时输出一次性 info，避免「静默恢复」导致运维误判仍处于降级 */
  private markRecovered(): void {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log('限流共享存储已恢复，计数回到 Redis');
    }
  }
}

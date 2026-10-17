import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { delay } from 'es-toolkit';

import { UNLOCK_LUA_SCRIPT } from '@/database/lua-scripts';
import { RedisService } from '@/database/redis.service';

/** 解锁 Lua 脚本：安全核对 Token，防止误删他人的锁 */

/** IETF 草案与 Stripe 工业标准：Key 最大 256 字符，可见 ASCII 字符 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;

/** 回放时必须剔除的跳步（Hop-by-hop）与敏感状态请求头 */
export const DISALLOWED_REPLAY_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'cookie',
  'authorization',
  'x-idempotency-replayed',
]);

/** 容灾策略类型 */
export type FallbackStrategy = 'fail-closed' | 'fail-open';

export interface AcquireIdempotencyParams {
  key: string;
  actor: string;
  requestPath: string;
  payloadHash: string;
  ttlSeconds?: number;
  lockTtlMs?: number;
  waitTimeoutMs?: number;
  retryIntervalMs?: number;
  fallback?: FallbackStrategy;
}

export interface CachedResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string> | null;
}

export interface StoredIdempotencyData {
  requestPath: string;
  payloadHash: string;
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type AcquireResult =
  | { acquired: true; lockToken: string; cacheKey: string; lockKey: string; bypass?: false }
  | { acquired: false; cached: CachedResponse; bypass?: false }
  | { acquired: false; bypass: true };

/**
 * 深度递归将数据结构规范化，对所有对象的 key 进行字典序升序排序，
 * 保证相同语义但 key 顺序不同的 JSON 结构输出 100% 确定性的字符串。
 */
export function canonicalize(val: unknown, seen = new WeakSet()): unknown {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (seen.has(val)) {
    return '[Circular]';
  }
  seen.add(val);

  if (Array.isArray(val)) {
    return val.map((item) => canonicalize(item, seen));
  }

  const obj = val as Record<string, unknown>;
  const sortedObj: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const propVal = obj[key];
    if (propVal !== undefined && typeof propVal !== 'function' && typeof propVal !== 'symbol') {
      sortedObj[key] = canonicalize(propVal, seen);
    }
  }
  return sortedObj;
}

/**
 * 确定性 Canonical JSON 序列化器
 */
export function canonicalStringify(value: unknown): string {
  if (value === undefined || value === null) {
    return '{}';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(canonicalize(value)) ?? '{}';
  } catch {
    return JSON.stringify(value ?? {});
  }
}

/**
 * 生产级 API 幂等性核心服务：
 * - 纯正 Redis 驱动（对齐 square1-io/laravel-idempotency 设计规范）
 * - 分布式排他锁（SET NX PX + Lua 原子安全释放）
 * - 优雅自旋等待（Wait for Lock）：慢请求并发时，后续请求在超时阈值内自旋等待锁释放，直接回放缓存响应
 * - 严格双重防篡改校验（Path 路径与 Canonical SHA-256 哈希校验，不符直抛 422）
 * - 精准用户/IP 作用域隔离（Actor Scope）
 * - 工业级安全防护（Key 格式限制、敏感头脱敏、状态码策略）
 * - 完备容灾降级（Fail-Closed 防资损 vs Fail-Open 优先可用性）
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  // 默认配置常数
  public static readonly DEFAULT_CACHE_TTL_SECONDS = 86400; // 1 天
  public static readonly DEFAULT_LOCK_TTL_MS = 30000; // 30 秒分布式执行锁
  public static readonly DEFAULT_WAIT_TIMEOUT_MS = 5000; // 5 秒并发等待窗口
  public static readonly DEFAULT_RETRY_INTERVAL_MS = 50; // 50 毫秒自旋采样间隔

  constructor(private readonly redis: RedisService) {}

  /**
   * 校验 Idempotency-Key 请求头合法性（遵循 IETF 草案与 Stripe 工业标准）
   */
  validateIdempotencyKey(key: string): void {
    if (!key) {
      throw new BadRequestException('Idempotency-Key header cannot be empty');
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(`Idempotency-Key header must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key header contains invalid characters. Only printable ASCII characters are allowed.',
      );
    }
  }

  /**
   * 判断 HTTP 响应状态码是否属于可持久化到幂等缓存的范围
   * 规则：
   * 1. 若显式指定了 customCodes，以 customCodes 白名单为准；
   * 2. 默认缓存 2xx 成功与确定性 4xx 业务错误（防重复扣款、重复失败提交）；
   * 3. 严格排除瞬态错误：409 Conflict（并发冲突）、429 Too Many Requests（限流），以及 5xx 服务端故障（允许重试）。
   */
  isCacheableStatusCode(statusCode: number, customCodes?: number[]): boolean {
    if (customCodes && customCodes.length > 0) {
      return customCodes.includes(statusCode);
    }
    // 2xx 成功响应：全量缓存
    if (statusCode >= 200 && statusCode < 300) {
      return true;
    }
    // 4xx 客户端错误：缓存除 409 与 429 之外的确定性业务错误
    if (statusCode >= 400 && statusCode < 500) {
      return statusCode !== 409 && statusCode !== 429;
    }
    // 3xx、5xx 服务端内部错误一律不缓存
    return false;
  }

  /**
   * 安全净化回放响应头：剥离 Hop-by-hop 及 Set-Cookie 等敏感/逐跳头
   */
  sanitizeHeadersForReplay(headers?: Record<string, string> | null): Record<string, string> {
    if (!headers) {
      return {};
    }
    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase().trim();
      if (!DISALLOWED_REPLAY_HEADERS.has(lowerKey)) {
        cleanHeaders[key] = value;
      }
    }
    return cleanHeaders;
  }

  /** 计算请求体 SHA-256 签名哈希（基于 Canonical JSON 键排序，消除字段乱序歧义） */
  computePayloadHash(payload: unknown): string {
    const serialized = canonicalStringify(payload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /** 构建幂等响应缓存键名 */
  buildCacheKey(actor: string, key: string): string {
    return this.redis.key('idempotency', 'cache', actor, key);
  }

  /** 构建幂等并发排他锁键名 */
  buildLockKey(actor: string, key: string): string {
    return this.redis.key('idempotency', 'lock', actor, key);
  }

  /**
   * 基于 Redis 缓存与分布式原子排他锁认领幂等记录：
   * 1. 查询缓存，若已存在则进行 Path 与 Payload 校验，通过直接回放；
   * 2. 缓存不存在则尝试原子抢锁（SET NX PX）；
   * 3. 抢锁成功返回持有凭证；
   * 4. 抢锁失败进入自旋轮询等待（waitForCacheLock），等待前一个并发请求完成或释放；
   * 5. 若 Redis 基础设施异常，根据 fallback 策略决定抛出 503 或是 fail-open 降级放行。
   */
  async acquire(params: AcquireIdempotencyParams): Promise<AcquireResult> {
    const {
      key,
      actor,
      requestPath,
      payloadHash,
      lockTtlMs = IdempotencyService.DEFAULT_LOCK_TTL_MS,
      waitTimeoutMs = IdempotencyService.DEFAULT_WAIT_TIMEOUT_MS,
      retryIntervalMs = IdempotencyService.DEFAULT_RETRY_INTERVAL_MS,
      fallback = 'fail-closed',
    } = params;

    const cacheKey = this.buildCacheKey(actor, key);
    const lockKey = this.buildLockKey(actor, key);

    try {
      // 1. 先检查是否命中已完成的幂等缓存
      const cachedData = await this.getCachedRecord(cacheKey);
      if (cachedData) {
        return this.verifyAndReturnCached(cachedData, requestPath, payloadHash);
      }

      // 2. 尝试获取分布式排他锁（抢占执行权）
      const lockToken = randomUUID();
      if (await this.tryAcquireLock(lockKey, lockToken, lockTtlMs)) {
        return { acquired: true, lockToken, cacheKey, lockKey };
      }

      // 3. 锁被占用：进入对齐 square1 的自旋等待流程（优雅等待慢请求完成直接消费缓存）
      return await this.waitForCacheLock({
        cacheKey,
        lockKey,
        lockToken,
        lockTtlMs,
        requestPath,
        payloadHash,
        waitTimeoutMs,
        retryIntervalMs,
      });
    } catch (error) {
      // 业务校验不符 (422) 或等待超时 (409) 等标准 HTTP 异常正常上抛
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Redis failure during idempotency acquire for ${cacheKey}: ${String(error)}`);

      if (fallback === 'fail-open') {
        this.logger.warn(`Idempotency fallback to fail-open for ${cacheKey}. Request proceeding without idempotency.`);
        return { acquired: false, bypass: true };
      }

      throw new ServiceUnavailableException('Idempotency service temporarily unavailable. Please retry later.');
    }
  }

  /**
   * 业务处理成功后，持久化响应数据至 Redis 缓存并安全释放互斥锁
   */
  async complete(params: {
    cacheKey: string;
    lockKey: string;
    lockToken: string;
    requestPath: string;
    payloadHash: string;
    statusCode: number;
    responseBody: unknown;
    responseHeaders?: Record<string, string>;
    ttlSeconds?: number;
  }): Promise<void> {
    const {
      cacheKey,
      lockKey,
      lockToken,
      requestPath,
      payloadHash,
      statusCode,
      responseBody,
      responseHeaders = {},
      ttlSeconds = IdempotencyService.DEFAULT_CACHE_TTL_SECONDS,
    } = params;

    const data: StoredIdempotencyData = {
      requestPath,
      payloadHash,
      statusCode,
      body: responseBody,
      headers: responseHeaders,
    };

    try {
      // 写入持久缓存
      await this.redis.getClient().set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Failed to cache idempotency response for ${cacheKey}: ${String(error)}`);
    } finally {
      // 无论写盘是否成功，必须安全释放排他锁
      await this.releaseLock(lockKey, lockToken);
    }
  }

  /**
   * 业务处理失败或异常中断时，立即释放锁，允许客户端后续重试
   */
  async fail(params: { lockKey: string; lockToken: string }): Promise<void> {
    await this.releaseLock(params.lockKey, params.lockToken);
  }

  /** 读取并反序列化已缓存的响应对象 */
  private async getCachedRecord(cacheKey: string): Promise<StoredIdempotencyData | null> {
    const raw = await this.redis.getClient().get(cacheKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as StoredIdempotencyData;
    } catch (error) {
      this.logger.warn(`Corrupted idempotency cache data at ${cacheKey}: ${String(error)}`);
      return null;
    }
  }

  /** 校验请求一致性（Path 和 Payload）并包装回放对象 */
  private verifyAndReturnCached(
    cached: StoredIdempotencyData,
    requestPath: string,
    payloadHash: string,
  ): AcquireResult {
    // 1. 路径不匹配校验 (对齐 square1 MismatchedPathException)
    if (cached.requestPath !== requestPath) {
      throw new UnprocessableEntityException('Idempotency key path mismatch');
    }

    // 2. 载荷防篡改校验 (对齐 square1 防篡改与 API 规范)
    if (cached.payloadHash !== payloadHash) {
      throw new UnprocessableEntityException('Idempotency key payload mismatch');
    }

    // 3. 校验通过，直接返回回放对象
    return {
      acquired: false,
      cached: {
        statusCode: cached.statusCode,
        body: cached.body,
        headers: cached.headers,
      },
    };
  }

  /**
   * 自旋轮询等待前一个并发请求释放锁或完成缓存写入
   */
  private async waitForCacheLock(params: {
    cacheKey: string;
    lockKey: string;
    lockToken: string;
    lockTtlMs: number;
    requestPath: string;
    payloadHash: string;
    waitTimeoutMs: number;
    retryIntervalMs: number;
  }): Promise<AcquireResult> {
    const { cacheKey, lockKey, lockToken, lockTtlMs, requestPath, payloadHash, waitTimeoutMs, retryIntervalMs } =
      params;

    const startTime = Date.now();

    while (Date.now() - startTime < waitTimeoutMs) {
      await delay(retryIntervalMs);

      // a. 检查前一个请求是否已经完成并写入了缓存
      const cached = await this.getCachedRecord(cacheKey);
      if (cached) {
        return this.verifyAndReturnCached(cached, requestPath, payloadHash);
      }

      // b. 若尚未写入缓存，检查前一个持有锁的请求是否失败退出了（锁已释放）
      if (await this.tryAcquireLock(lockKey, lockToken, lockTtlMs)) {
        // 成功接管锁执行权，转为当前请求执行
        return { acquired: true, lockToken, cacheKey, lockKey };
      }
    }

    // 超出等待窗口仍未就绪，抛出 409 退避提示（对齐 square1 LockWaitExceededException）
    throw new ConflictException(
      'A previous request with the same Idempotency-Key is currently in progress. Please retry after a backoff.',
    );
  }

  /** 尝试抢占分布式排他锁（SET NX PX），成功返回 true */
  private async tryAcquireLock(lockKey: string, lockToken: string, lockTtlMs: number): Promise<boolean> {
    const result = await this.redis.getClient().set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');
    return result === 'OK';
  }

  /** 使用 Lua 脚本基于 Token 原子安全释放锁 */
  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    try {
      await this.redis.getClient().eval(UNLOCK_LUA_SCRIPT, 1, lockKey, lockToken);
    } catch (error) {
      this.logger.warn(`Failed to release lock for ${lockKey}: ${String(error)}`);
    }
  }
}

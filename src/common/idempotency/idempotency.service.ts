import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { IdempotencyStoredResponse } from '@nestjs/idempotency';
import { delay } from 'es-toolkit';

import { DrizzleIdempotencyStore } from './drizzle-idempotency.store';

/** IETF 草案与官方契约：Key 为 1–255 个可见 ASCII 字符 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;

/** 机器可读错误码：与 @nestjs/idempotency 官方 `IDEMPOTENCY_*` 对齐，客户端按 code 分支而非文案 */
export const IDEMPOTENCY_ERROR_CODES = {
  KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  KEY_IN_USE: 'IDEMPOTENCY_KEY_IN_USE',
  KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const;

/** 409 的默认建议重试间隔（秒），对齐官方 `retryAfter` 默认值 */
const DEFAULT_RETRY_AFTER_SECONDS = 1;

/** 幂等键仍在处理中：409 + `Retry-After`（响应头由全局异常过滤器写回） */
class IdempotencyKeyInUseException extends HttpException {
  readonly headers: Record<string, string>;

  constructor(retryAfterSeconds: number) {
    super(
      {
        code: IDEMPOTENCY_ERROR_CODES.KEY_IN_USE,
        message: 'A request with this idempotency key is still being processed.',
      },
      HttpStatus.CONFLICT,
    );
    this.headers = { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) };
  }
}

/** 同 key 但 path / method / payload 任一不同：422 `IDEMPOTENCY_KEY_REUSED` */
function reusedKeyException(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: IDEMPOTENCY_ERROR_CODES.KEY_REUSED,
    message: 'This idempotency key was already used for a different request.',
  });
}

/** 容灾策略类型 */
export type FallbackStrategy = 'fail-closed' | 'fail-open';

export interface AcquireIdempotencyParams {
  key: string;
  actor: string;
  requestPath: string;
  /** HTTP 方法：与 path、payload 一同构成指纹（官方默认计入 method，防同路径不同方法互相回放） */
  method?: string;
  payloadHash: string;
  ttlSeconds?: number;
  lockTtlMs?: number;
  waitTimeoutMs?: number;
  retryIntervalMs?: number;
  /** 409 时 `Retry-After` 的建议等待秒数 */
  retryAfterSeconds?: number;
  fallback?: FallbackStrategy;
}

export interface CachedResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string> | null;
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

  // seen 只标记「当前递归路径」：离开时出栈，兄弟属性复用同一对象不会被误判为循环引用
  seen.add(val);
  try {
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
  } finally {
    seen.delete(val);
  }
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
 * - 委托原生 DrizzleIdempotencyStore 完成数据库级单语句原子抢占与并发租约
 * - 声明式与编程式（如 PaymentsService）统一门面
 * - 严格双重防篡改校验（Path 路径与 Canonical SHA-256 哈希校验，不符直抛 422）
 * - 优雅自旋等待（Wait for Lock）：慢请求并发时自动自旋等待抢锁或消费回放结果
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

  constructor(private readonly store: DrizzleIdempotencyStore) {}

  /**
   * 校验 Idempotency-Key 请求头合法性（遵循 IETF 草案与 Stripe 工业标准）
   */
  validateIdempotencyKey(key: string): void {
    if (!key) {
      throw this.invalidKey('An idempotency key is required for this operation.');
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw this.invalidKey(
        `The idempotency key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} printable ASCII characters.`,
      );
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw this.invalidKey(
        `The idempotency key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} printable ASCII characters.`,
      );
    }
  }

  /** 非法 Key 统一 400 + `IDEMPOTENCY_KEY_INVALID`（详情见 message，code 供客户端分支） */
  private invalidKey(message: string): BadRequestException {
    return new BadRequestException({ code: IDEMPOTENCY_ERROR_CODES.KEY_INVALID, message });
  }

  /** 计算请求体 SHA-256 签名哈希（基于 Canonical JSON 键排序，消除字段乱序歧义） */
  computePayloadHash(payload: unknown): string {
    const serialized = canonicalStringify(payload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /** 构建幂等响应缓存键名 */
  buildCacheKey(actor: string, key: string): string {
    return `idempotency:cache:${actor}:${key}`;
  }

  /** 构建幂等并发排他锁键名 */
  buildLockKey(actor: string, key: string): string {
    return `idempotency:lock:${actor}:${key}`;
  }

  /**
   * 认领幂等记录或命中回放缓存（支持自旋等待与容灾降级）
   */
  async acquire(params: AcquireIdempotencyParams): Promise<AcquireResult> {
    const {
      key,
      actor,
      requestPath,
      method = 'POST',
      payloadHash,
      lockTtlMs = IdempotencyService.DEFAULT_LOCK_TTL_MS,
      waitTimeoutMs = IdempotencyService.DEFAULT_WAIT_TIMEOUT_MS,
      retryIntervalMs = IdempotencyService.DEFAULT_RETRY_INTERVAL_MS,
      retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS,
      fallback = 'fail-closed',
    } = params;

    const scopedKey = `${actor}:${key}`;
    const cacheKey = this.buildCacheKey(actor, key);
    const lockKey = this.buildLockKey(actor, key);
    const lockToken = randomUUID();
    // method 计入指纹：同路径不同方法（PUT/POST）不得互相回放
    const fingerprint = `${method.toUpperCase()} ${requestPath}:${payloadHash}`;

    const startTime = Date.now();

    while (true) {
      try {
        const res = await this.store.acquire(scopedKey, lockToken, fingerprint, lockTtlMs);

        if (res.state === 'acquired') {
          return { acquired: true, lockToken, cacheKey, lockKey };
        }

        // 指纹整串比较：method / path / payload 任一变化都视为 key 复用
        if (res.fingerprint !== fingerprint) {
          throw reusedKeyException();
        }

        if (res.state === 'completed') {
          const stored = res.response as IdempotencyStoredResponse;
          return {
            acquired: false,
            cached: {
              statusCode: stored.status,
              body: stored.body,
              headers: (stored.headers as Record<string, string>) ?? {},
            },
          };
        }

        // res.state === 'in-flight'：慢请求并发中，在超时窗口内自旋等待
        if (Date.now() - startTime >= waitTimeoutMs) {
          throw new IdempotencyKeyInUseException(retryAfterSeconds);
        }

        await delay(retryIntervalMs);
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }

        this.logger.error(`Idempotency store failure during acquire for ${scopedKey}: ${String(error)}`);

        if (fallback === 'fail-open') {
          this.logger.warn(
            `Idempotency fallback to fail-open for ${scopedKey}. Request proceeding without idempotency.`,
          );
          return { acquired: false, bypass: true };
        }

        throw new ServiceUnavailableException('Idempotency service temporarily unavailable. Please retry later.');
      }
    }
  }

  /**
   * 业务处理成功后，持久化响应数据并安全释放互斥锁
   *
   * fail-closed：CAS 未命中（租约已过期或被其他副本接管）与存储异常一律上抛 503。
   * 支付回调等调用方据此不向上游 ACK 成功；若在此吞掉错误，上游停止重投而幂等记录
   * 仍然缺失，租约到期后重复回调会被重新派发，形成重复发货/重复记账。
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
      lockKey,
      lockToken,
      statusCode,
      responseBody,
      responseHeaders = {},
      ttlSeconds = IdempotencyService.DEFAULT_CACHE_TTL_SECONDS,
    } = params;

    const scopedKey = this.extractScopedKey(lockKey);
    const ttlMs = ttlSeconds * 1000;

    try {
      const persisted = await this.store.complete(
        scopedKey,
        lockToken,
        {
          status: statusCode,
          headers: responseHeaders,
          body: responseBody,
        },
        ttlMs,
      );

      if (!persisted) {
        this.logger.error(`Idempotency CAS lost for ${scopedKey}: lease expired or taken over by another replica`);
        throw new ServiceUnavailableException('Idempotency record not persisted. Please retry later.');
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to complete idempotency record for ${scopedKey}: ${String(error)}`);
      throw new ServiceUnavailableException('Idempotency service temporarily unavailable. Please retry later.');
    }
  }

  /**
   * 业务处理失败或异常中断时，立即释放锁，允许客户端后续重试
   */
  async fail(params: { lockKey: string; lockToken: string }): Promise<void> {
    const scopedKey = this.extractScopedKey(params.lockKey);
    try {
      await this.store.release(scopedKey, params.lockToken);
    } catch (error) {
      this.logger.warn(`Failed to release idempotency lock for ${scopedKey}: ${String(error)}`);
    }
  }

  /**
   * 启动锁续租心跳（长事务防过期）。
   *
   * 续租 CAS 未命中（`extend` 返回 `false`）意味着本副本已失去租约，后续 `complete`
   * 必然失败，故记 error 日志并停止心跳，不再无效续租。
   *
   * @returns 停止函数，必须在 complete / fail 后调用
   */
  startLockHeartbeat(params: { lockKey: string; lockToken: string; lockTtlMs?: number }): () => void {
    const scopedKey = this.extractScopedKey(params.lockKey);
    const lockTtlMs = params.lockTtlMs ?? IdempotencyService.DEFAULT_LOCK_TTL_MS;
    const intervalMs = Math.max(Math.floor(lockTtlMs / 3), 1_000);

    const timer = setInterval(() => {
      this.store
        .extend(scopedKey, params.lockToken, lockTtlMs)
        .then((renewed) => {
          if (!renewed) {
            this.logger.error(`Lost idempotency lock lease for ${scopedKey}: extend CAS missed, stopping heartbeat`);
            clearInterval(timer);
          }
        })
        .catch((error) => {
          this.logger.warn(`Failed to renew idempotency lock for ${scopedKey}: ${String(error)}`);
        });
    }, intervalMs);

    timer.unref?.();

    return () => clearInterval(timer);
  }

  private extractScopedKey(key: string): string {
    const prefix = 'idempotency:';
    if (key.startsWith(prefix)) {
      const parts = key.split(':');
      if (parts.length >= 4) {
        return parts.slice(2).join(':');
      }
    }
    return key;
  }
}

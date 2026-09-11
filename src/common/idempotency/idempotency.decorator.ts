import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'IDEMPOTENT_METADATA';

export interface IdempotentOptions {
  /** 是否强制要求必须携带 Idempotency-Key 请求头（若为 true 且请求缺少 Header 则直接拒绝并返回 400） */
  required?: boolean;
  /** 幂等记录响应缓存有效期（秒），默认 24 小时 (86400 秒) */
  ttlSeconds?: number;
  /** 并发遇到锁冲突时自旋等待释放的最长耗时（毫秒），默认 5000 毫秒 */
  waitTimeoutMs?: number;
  /** 分布式排他锁的最大占用超时（毫秒），默认 30000 毫秒（防止业务挂死导致死锁） */
  lockTtlMs?: number;
  /** Redis 基础设施故障时的容灾策略：'fail-closed'（默认，抛 503 防资损）或 'fail-open'（放行请求，优先可用性） */
  fallback?: 'fail-closed' | 'fail-open';
  /** 可缓存的 HTTP 响应状态码列表（默认缓存 2xx 与非临时 4xx，排除 409/429/5xx） */
  cacheStatusCodes?: number[];
}

/**
 * 声明端点具备 API 幂等性保障（遵循 square1/laravel-idempotency 与 RFC/Stripe 规范）。
 *
 * 在混合自适应模式下：
 * - 未标注该装饰器的写端点 (POST/PUT/PATCH/DELETE) 若客户端传入 `Idempotency-Key` 头也会自动原子接管；
 * - 标注了该装饰器且设置 `required: true` 时，则强制要求客户端必须提供 `Idempotency-Key`。
 */
export const Idempotent = (options: IdempotentOptions = {}) => SetMetadata(IDEMPOTENT_KEY, options);

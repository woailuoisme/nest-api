import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'IDEMPOTENT_METADATA';

export interface IdempotentOptions {
  /** 是否强制要求必须携带 Idempotency-Key 请求头（若为 true 且请求缺少 Header 则直接拒绝并返回 400） */
  required?: boolean;
  /** 幂等记录有效期（秒），默认 24 小时 (86400 秒) */
  ttlSeconds?: number;
}

/**
 * 声明端点具备 API 幂等性保障。
 *
 * 在智能自适应模式下，未标注该装饰器的写端点如果客户端传入了 `Idempotency-Key` 请求头也会自动生效；
 * 标注了该装饰器且设置 `required: true` 时，则强制要求调用方必须提供 `Idempotency-Key`。
 */
export const Idempotent = (options: IdempotentOptions = {}) => SetMetadata(IDEMPOTENT_KEY, options);

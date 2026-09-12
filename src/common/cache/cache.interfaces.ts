/**
 * 统一缓存强类型契约
 */

export interface RememberOptions {
  /** 缓存过期时间（毫秒）。若不传则使用模块默认配置（默认 60s） */
  ttlMs?: number;

  /**
   * TTL 随机抖动比例（防雪崩）。
   * 例如 0.1 代表在原 TTL 基础上浮动 ±10%。设置为 0 表示禁用抖动。
   * 默认：0.1
   */
  jitterRatio?: number;

  /**
   * 是否防穿透（当 fetcher 返回 null 或 undefined 时，是否缓存空值哨兵）。
   * 默认：true
   */
  cacheNull?: boolean;

  /**
   * 空值防穿透缓存时间（毫秒）。通常设置较短时间以防长期脏缓存。
   * 默认：30_000 (30秒)
   */
  nullTtlMs?: number;

  /**
   * 是否显式仅对 L2 Redis 生效（绕过 L1 本地内存）。
   * 默认：false
   */
  skipL1?: boolean;
}

export interface CacheInvalidateMessage {
  /** 发布失效事件的节点实例 ID，用于当前节点自我过滤防自环 */
  originInstanceId: string;

  /** 需精确失效的缓存键 */
  key?: string;

  /** 需模式匹配失效的缓存键通配符 (如 'users:*') */
  pattern?: string;

  /** 事件发生时间戳 (毫秒) */
  timestamp: number;
}

export interface CacheModuleOptions {
  /** 默认全局缓存生存时间 (毫秒)，默认 60,000ms */
  defaultTtlMs?: number;

  /** L1 本地进程内内存短保护 TTL (毫秒)，默认 10,000ms */
  l1TtlMs?: number;

  /** 是否启用跨 Pod 的 Redis Pub/Sub 缓存失效广播，默认 true */
  enablePubSubInvalidation?: boolean;
}

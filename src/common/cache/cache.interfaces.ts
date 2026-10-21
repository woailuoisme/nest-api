/**
 * 统一缓存强类型契约
 */

export interface RememberOptions {
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
}

export interface CacheInvalidateMessage {
  /** 发布失效事件的节点实例 ID，用于当前节点自我过滤防自环 */
  originInstanceId: string;

  /** 需失效的缓存键；`*` 表示清空本节点全部 L1 缓存 */
  key: string;

  /** 事件发生时间戳 (毫秒) */
  timestamp: number;
}

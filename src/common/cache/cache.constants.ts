/**
 * 统一缓存常量定义
 */

/** Redis Pub/Sub 跨实例多级缓存失效广播频道 */
export const CACHE_INVALIDATE_CHANNEL = 'cache:events:invalidate';

/** 默认缓存生存时间 (毫秒)：60 秒 */
export const DEFAULT_CACHE_TTL_MS = 60 * 1000;

/** 默认 L1 本地内存短保护 TTL (毫秒)：10 秒，防止跨节点更新异常下的长期内存脏读 */
export const DEFAULT_L1_TTL_MS = 10 * 1000;

/** 默认防穿透空值缓存 TTL (毫秒)：30 秒 */
export const DEFAULT_NULL_CACHE_TTL_MS = 30 * 1000;

/** 空值防穿透哨兵标记对象 */
export const NULL_CACHE_SENTINEL = '__CACHE_NIL_SENTINEL__';

/** L1 内存存储实例独立注入令牌 */
export const CACHE_L1_STORE = 'CACHE_L1_STORE';

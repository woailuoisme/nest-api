/**
 * Redis Lua 脚本目录 — 全仓脚本的唯一事实源
 *
 * **加载策略（按调用频率选择，不得在调用处内联复制脚本文本）**：
 * - 请求热路径脚本：用 `client.defineCommand(name, { numberOfKeys, lua })` 注册，
 *   ioredis 会以 EVALSHA 优先、NOSCRIPT 自动回退 EVAL 的方式调用，避免每次请求重传脚本体；
 * - 低频脚本（如分布式锁释放，只在临界区执行一次）：直接 `client.eval(script, numKeys, ...)`，
 *   脚本体仅数行，无需额外缓存层。
 *
 * 历史上解锁脚本曾在 `redis.service.ts` 与 `idempotency.service.ts` 各存一份，此处统一收敛。
 */

/** 原子解锁：仅当锁值等于持有的 token 时才删除，杜绝误释放他人持有的锁 */
export const UNLOCK_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * 原子限流计数（单次往返完成全部读改写，杜绝多副本下的读-改-写竞态）
 *
 * KEYS[1] = 窗口计数键，KEYS[2] = 封禁键；ARGV = ttl / limit / blockDuration（均毫秒）
 * 返回 `{ 命中数, 窗口剩余毫秒, 是否封禁(0|1), 封禁剩余毫秒 }`，与 @nestjs/throttler 内置存储的语义逐项对齐：
 * - 首次命中才设置窗口过期（固定窗口），后续命中不续期，避免「每次请求都刷新窗口」导致永不限流；
 * - 命中数超过 limit 时进入封禁期；`blockDuration <= 0`（未配置封禁时长）时以窗口剩余时间作为重试窗口；
 * - 封禁期内直接返回，不再继续自增，避免封禁期内计数被无意义放大。
 */
export const THROTTLE_INCREMENT_LUA_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl and blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1])) or 0
  local windowTtl = redis.call('PTTL', KEYS[1])
  if windowTtl < 1 then windowTtl = 0 end
  return { hits, windowTtl, 1, blockTtl }
end

local hits = tonumber(redis.call('INCR', KEYS[1]))
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end

local windowTtl = redis.call('PTTL', KEYS[1])
if windowTtl < 1 then windowTtl = 0 end

local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
if hits > limit then
  if blockDuration > 0 then
    redis.call('SET', KEYS[2], 1, 'PX', blockDuration)
    return { hits, windowTtl, 1, blockDuration }
  end
  return { hits, windowTtl, 1, windowTtl }
end

return { hits, windowTtl, 0, 0 }
`;

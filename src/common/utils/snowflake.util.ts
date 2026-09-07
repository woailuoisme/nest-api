/**
 * Snowflake 分布式 ID 生成器 — 纯内存，零依赖，单线程友好。
 * 序列号溢出逻辑推进时间戳（不阻塞），时钟回拨重置状态后抛异常（可立即重试）。
 */
import { SNOWFLAKE } from '@/common/constants/app.constants';

// ─── 模块常量 ──────────────────────────────────────────

/** Worker ID 左移位数 */
const WORKER_ID_SHIFT = SNOWFLAKE.SEQUENCE_BITS;
/** 时间戳左移位数 */
const TIMESTAMP_SHIFT = SNOWFLAKE.WORKER_ID_BITS + SNOWFLAKE.SEQUENCE_BITS;
/** 序列号最大值掩码 (0xFFF) */
const SEQUENCE_MASK = (1 << SNOWFLAKE.SEQUENCE_BITS) - 1;

/** 从环境变量读取 Worker ID，默认 1 */
const WORKER_ID = (() => {
  const env = process.env.SNOWFLAKE_WORKER_ID;
  const id = env ? Number.parseInt(env, 10) : 1;
  return id & ((1 << SNOWFLAKE.WORKER_ID_BITS) - 1);
})();

// ─── 运行时状态 ────────────────────────────────────────

let lastTimestamp = -1;
let sequence = 0;

// ─── 日期缓存 ──────────────────────────────────────────

/** 缓存的当日 YYYYMMDD 字符串，避免每次 new Date() */
let cachedDate = '';
let cachedDateKey = ''; // Date.toDateString() 返回值，用于跨月/跨年校验

/** 返回当日 YYYYMMDD 字符串，每日按需刷新一次 */
function today(): string {
  const now = new Date();
  const key = now.toDateString();
  if (cachedDateKey !== key) {
    cachedDateKey = key;
    cachedDate = now.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return cachedDate;
}

// ─── 核心算法 ──────────────────────────────────────────

/** 微回拨阈值 (ms)：小于此值视为溢出推进而非时钟回拨 */
const DRIFT_THRESHOLD = 10;

/**
 * 生成 Snowflake ID（同步，无 I/O，无 busy-wait）
 *
 * **序列号溢出** → 逻辑推进 lastTimestamp += 1，不阻塞事件循环
 * **微回拨 <10ms** → 视为溢出延续，继续逻辑推进，不抛异常
 * **大幅回拨 ≥10ms** → 重置状态后抛异常，调用方可立即重试
 */
function generateSnowflakeId(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    // 同一毫秒 → 自增序列号
    sequence = (sequence + 1) & SEQUENCE_MASK;
    if (sequence === 0) {
      // 序列号溢出 → 逻辑推进 1ms
      lastTimestamp += 1;
    }
  } else if (now > lastTimestamp) {
    // 新毫秒 → 序列号归零
    sequence = 0;
    lastTimestamp = now;
  } else {
    // now < lastTimestamp：可能是溢出推进或真正的时钟回拨
    const drift = lastTimestamp - now;
    if (drift <= DRIFT_THRESHOLD) {
      // 微回拨：溢出推进后自然滞后，继续逻辑推进
      sequence = (sequence + 1) & SEQUENCE_MASK;
      if (sequence === 0) {
        lastTimestamp += 1;
      }
    } else {
      // 大幅时钟回拨（如 VM 快照恢复），重置状态后抛异常
      lastTimestamp = now;
      sequence = 0;
      throw new Error(`Snowflake: 时钟大幅回拨 ${drift}ms，状态已重置，可立即重试`);
    }
  }

  // 在状态更新之后计算 timestamp，保证溢出/回拨后的一致性
  const timestamp = lastTimestamp - SNOWFLAKE.EPOCH;
  const id =
    (BigInt(timestamp) << BigInt(TIMESTAMP_SHIFT)) | (BigInt(WORKER_ID) << BigInt(WORKER_ID_SHIFT)) | BigInt(sequence);

  return id.toString();
}

// ─── 业务编号前缀 ──────────────────────────────────────

const BUSINESS_NO_PREFIX = {
  ORD: 'OrderNo', // 订单号
  TXN: 'TransactionNo', // 交易号
  RFD: 'RefundNo', // 退款号
  PAY: 'PaymentNo', // 支付流水号
  SHP: 'ShipmentNo', // 发货单号
  INV: 'InvoiceNo', // 发票号
} as const;

/** 组装业务编号: 前缀 + YYYYMMDD + Snowflake ID */
function buildBusinessNo(prefix: string): string {
  return `${prefix}${today()}${generateSnowflakeId()}`;
}

// ─── 公开 API ──────────────────────────────────────────

/** 从 BUSINESS_NO_PREFIX 推导 genXxx 方法签名 */
type GenMethods<T extends Record<string, string>> = {
  [K in keyof T as `gen${T[K]}`]: () => string;
};

/**
 * Snowflake 门面 — 提供语义化的业务编号生成函数
 *
 * @example
 * ```ts
 * Snowflake.generate()              // "487659320118542336"
 * Snowflake.genOrderNo()            // "ORD20240811487659320118542336"
 * Snowflake.reset()                 // 重置内部状态（测试用）
 * ```
 */
export const Snowflake = {
  /** 生成原始 Snowflake ID (19 位纯数字) */
  generate: generateSnowflakeId,

  /** 通用: 按前缀生成业务编号（如 `Snowflake.gen('ORD')`） */
  gen: buildBusinessNo,

  /**
   * 重置内部状态（计数器 + 时间戳 + 日期缓存）
   * 仅供测试使用，生产环境勿调用
   */
  reset(): void {
    lastTimestamp = -1;
    sequence = 0;
    cachedDate = '';
    cachedDateKey = '';
  },

  /**
   * 按前缀批量生成 — 遍历 BUSINESS_NO_PREFIX 自动挂载 genXxx() 方法。
   */
  ...(Object.fromEntries(
    Object.entries(BUSINESS_NO_PREFIX).map(([prefix, name]) => [`gen${name}`, () => buildBusinessNo(prefix)]),
  ) as GenMethods<typeof BUSINESS_NO_PREFIX>),
};

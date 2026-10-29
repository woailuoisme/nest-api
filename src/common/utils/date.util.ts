/** 秒级时间戳上界：小于该量级视为秒级（毫秒时间戳自 1973 年起即远超此值） */
const SECONDS_TIMESTAMP_UPPER_BOUND = 1e11;

/**
 * 归一化时间字段：兼容 Date / 秒级或毫秒级时间戳 / 日期字符串。
 *
 * 响应 DTO 构造函数的输入可能来自数据库驱动（Date）、搜索引擎 hydrate（秒级数字）
 * 或历史接口（ISO 字符串），统一收敛为 Date，交给序列化层按 schema 输出。
 */
export function toDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    return value;
  }
  const ms = typeof value === 'number' && value < SECONDS_TIMESTAMP_UPPER_BOUND ? value * 1000 : value;
  return new Date(ms);
}

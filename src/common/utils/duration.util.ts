/** 时长字符串支持的单位后缀 → 毫秒倍数 */
const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** 匹配「数字 + 可选单位」的时长字符串，如 500ms、15m、7d */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d|w)?$/;

/**
 * 解析时长字符串为毫秒数（如 '7d' → 604800000）。
 * 纯数字按毫秒处理；非法输入或超出安全整数范围抛错，用于将 JWT 过期时间等 env 配置转换为毫秒。
 * @param value - 时长字符串，支持 ms/s/m/h/d/w 后缀或纯数字（毫秒）
 */
export function parseDuration(value: string): number {
  const match = value.trim().toLowerCase().match(DURATION_PATTERN);
  if (!match) {
    throw new Error(`Invalid duration format: "${value}"`);
  }

  const [, amount, unit] = match;
  const multiplier = UNIT_TO_MS[unit] ?? 1;
  const result = Number(amount) * multiplier;
  // 防止 env 配置失误导致溢出，产生无效 Date
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Duration out of safe integer range: "${value}"`);
  }
  return result;
}

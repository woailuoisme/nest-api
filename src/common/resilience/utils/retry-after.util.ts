export const DEFAULT_RETRY_AFTER_SECONDS = 5;
export const DEFAULT_JITTER_RATIO = 0.3;

/**
 * 计算带有随机抖动 (Full/Equal Jitter) 的 Retry-After 退避秒数，
 * 遵循 AWS Well-Architected 与 Cloudflare 防惊群 (Thundering Herd) 规范，
 * 将瞬时脱落重试洪峰均匀打散至时间窗口内，防止引发二次重试风暴 (Retry Storm)。
 *
 * @param baseSeconds 基础重试退避秒数（默认：5s）
 * @param jitterRatio 抖动幅度比例（默认：0.3，即 70% ~ 130%）
 * @returns 抖动后的整数秒数（严格保证 >= 1）
 */
export function calculateJitteredRetryAfter(
  baseSeconds = DEFAULT_RETRY_AFTER_SECONDS,
  jitterRatio = DEFAULT_JITTER_RATIO,
): number {
  const min = Math.max(1, baseSeconds * (1 - jitterRatio));
  const max = baseSeconds * (1 + jitterRatio);
  const jittered = min + Math.random() * (max - min);
  return Math.max(1, Math.round(jittered));
}

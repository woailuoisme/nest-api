/** 豁免负载脱落元数据 Key */
export const BYPASS_LOAD_SHEDDING_KEY = 'RESILIENCE:BYPASS_LOAD_SHEDDING';

/** 流量优先级元数据 Key */
export const TRAFFIC_PRIORITY_KEY = 'RESILIENCE:TRAFFIC_PRIORITY';

/** 流量优先级等级（遵循 Google SRE / AWS 行业标准分级） */
export enum TrafficPriority {
  /** 核心业务层级：认证/支付/核心交易/系统探针，容忍极高延迟与内存水位才脱落 */
  CRITICAL = 'CRITICAL',
  /** 日常标准业务层级：默认中度阈值脱落，保持系统基准吞吐与健康状态 */
  DEFAULT = 'DEFAULT',
  /** 旁路/非核心层级：报表/导出/埋点/推荐，轻微过载即脱落为核心业务让行 */
  SHEDDABLE = 'SHEDDABLE',
}

/** 默认最大事件循环延迟阈值（毫秒），P95 超过该值则判定为事件循环严重阻塞 */
export const DEFAULT_MAX_EVENT_LOOP_DELAY_MS = 150;

/** 默认最大堆内存使用比例警戒线（0 ~ 1.0），heapUsed / heapTotal 超过该值判定为内存告急 */
export const DEFAULT_MAX_HEAP_USED_RATIO = 0.85;

/** 默认过载响应的 Retry-After 建议秒数 */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** 默认重试退避抖动幅度比例（±30%，即 70% ~ 130%） */
export const DEFAULT_JITTER_RATIO = 0.3;

/**
 * 计算带有随机抖动 (Full/Equal Jitter) 的 Retry-After 退避秒数，
 * 遵循 AWS Well-Architected 与 Cloudflare 防惊群 (Thundering Herd) 规范，
 * 将瞬时脱落重试洪峰均匀打散至时间窗口内，防止引发二次重试风暴 (Retry Storm)。
 *
 * @param baseSeconds 基础重试退避秒数（默认：DEFAULT_RETRY_AFTER_SECONDS = 5s）
 * @param jitterRatio 抖动幅度比例（默认：DEFAULT_JITTER_RATIO = 0.3）
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

export interface PriorityThresholdConfig {
  /** 事件循环 P95 延迟阈值（毫秒） */
  maxEventLoopDelayMs: number;
  /** 堆内存使用比例警戒线（0 ~ 1.0） */
  maxHeapUsedRatio: number;
}

/** 分级阶梯自适应脱落阈值表 */
export const TIERED_LOAD_SHEDDING_THRESHOLDS: Record<TrafficPriority, PriorityThresholdConfig> = {
  [TrafficPriority.SHEDDABLE]: {
    maxEventLoopDelayMs: 60,
    maxHeapUsedRatio: 0.75,
  },
  [TrafficPriority.DEFAULT]: {
    maxEventLoopDelayMs: DEFAULT_MAX_EVENT_LOOP_DELAY_MS,
    maxHeapUsedRatio: DEFAULT_MAX_HEAP_USED_RATIO,
  },
  [TrafficPriority.CRITICAL]: {
    maxEventLoopDelayMs: 300,
    maxHeapUsedRatio: 0.92,
  },
};

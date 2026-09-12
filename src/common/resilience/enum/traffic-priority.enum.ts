/**
 * 流量优先级等级（遵循 Google SRE / AWS 行业标准分级）
 */
export enum TrafficPriority {
  /** 核心业务层级：认证/支付/核心交易/系统探针，容忍极高延迟与内存水位才脱落 */
  CRITICAL = 'CRITICAL',
  /** 日常标准业务层级：默认中度阈值脱落，保持系统基准吞吐与健康状态 */
  DEFAULT = 'DEFAULT',
  /** 旁路/非核心层级：报表/导出/埋点/推荐，轻微过载即脱落为核心业务让行 */
  SHEDDABLE = 'SHEDDABLE',
}

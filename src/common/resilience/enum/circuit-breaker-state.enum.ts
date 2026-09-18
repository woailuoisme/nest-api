/**
 * 熔断器状态枚举 (Circuit Breaker Status)
 */
export enum CircuitBreakerStatus {
  /** 闭合状态：服务正常，所有请求正常放行并统计失败率 */
  Closed = 'Closed',
  /** 半开状态：熔断超时后进入试探恢复期，放行受限请求评估服务健康 */
  HalfOpen = 'HalfOpen',
  /** 打开跳闸状态：失败率超限，快速失败短路请求 */
  Open = 'Open',
}

/** 兼容别名 */
export const CircuitBreakerState = CircuitBreakerStatus;
export type CircuitBreakerState = CircuitBreakerStatus;

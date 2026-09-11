import { SetMetadata } from '@nestjs/common';
import { BYPASS_LOAD_SHEDDING_KEY, TRAFFIC_PRIORITY_KEY, TrafficPriority } from './load-shedding.constants';

/**
 * 豁免当前控制器或端点参与负载脱落检查（Load Shedding）
 *
 * 适用于健康检查（如 /health、Kubernetes 存活/就绪探针）或运维管理特权端点，
 * 保证即使在主线程重度负载下探针与管理员排查请求仍能正常穿透。
 *
 * @example
 * ```typescript
 * @Get('health')
 * @BypassLoadShedding()
 * checkHealth() {
 *   return this.healthService.check();
 * }
 * ```
 */
export const BypassLoadShedding = () => SetMetadata(BYPASS_LOAD_SHEDDING_KEY, true);

/**
 * 声明控制器或方法处理的流量优先级（Traffic Priority / Criticality）
 *
 * 遵循 Google SRE 分级脱落规范：
 * - TrafficPriority.CRITICAL: 核心认证/支付/探针，仅在极端过载（Lag > 300ms 或 堆内存 > 92%）脱落；
 * - TrafficPriority.DEFAULT: 常规业务（Lag > 150ms 或 堆内存 > 85%）脱落；
 * - TrafficPriority.SHEDDABLE: 旁路报表/埋点/推荐，轻度过载（Lag > 60ms 或 堆内存 > 75%）优先丢弃为核心业务让行。
 *
 * @example
 * ```typescript
 * @Get('reports/export')
 * @Priority(TrafficPriority.SHEDDABLE)
 * exportLargeReport() { ... }
 * ```
 */
export const Priority = (priority: TrafficPriority) => SetMetadata(TRAFFIC_PRIORITY_KEY, priority);

/**
 * 语法糖：声明当前端点为可优先脱落的非核心流量 (SHEDDABLE)
 *
 * 在系统出现轻微主线程延迟或内存紧张时最先丢弃，避免影响登录与交易。
 */
export const Sheddable = () => Priority(TrafficPriority.SHEDDABLE);

/**
 * 语法糖：声明当前端点为核心生命线流量 (CRITICAL)
 *
 * 享受最高保护调度，除非服务器濒临崩溃否则绝不脱落。
 */
export const Critical = () => Priority(TrafficPriority.CRITICAL);

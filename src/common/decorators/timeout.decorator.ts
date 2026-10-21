import { applyDecorators, SetMetadata } from '@nestjs/common';
import { type Duration, Timeout as ResilienceTimeout } from '@nestjs/resilience';

/** 路由超时时间元数据 Key (对齐 @nestjs/resilience) */
export const TIMEOUT_METADATA_KEY = 'resilience:timeout';

/** 旧版超时时间元数据 Key (保留向后兼容) */
export const LEGACY_TIMEOUT_METADATA_KEY = 'COMMON:REQUEST_TIMEOUT_MS';

/** 超时豁免元数据 Key */
export const BYPASS_TIMEOUT_KEY = 'COMMON:BYPASS_TIMEOUT';

/**
 * 声明控制器类或端点方法的请求超时时间
 *
 * 统一接入 NestJS 官方 `@nestjs/resilience` 弹性容灾中心：
 * - 超时时由内置错误映射层统一输出规范的 HTTP 504 Gateway Timeout（而非 408）；
 * - 原生支持数字毫秒（如 `5000`）或易读时间字面量（如 `'5s'`, `'1m'`）；
 * - 原生发布 timeout 事件至 ResilienceEvents 诊断通道。
 *
 * @param duration 超时时间 (数字毫秒或 '5s', '30s', '1m' 等字面量)
 *
 * @example
 * ```typescript
 * @Get('export')
 * @Timeout('60s') // 60s
 * async exportReport() { ... }
 *
 * @Get('quick')
 * @Timeout(2000) // 2000ms
 * async quickApi() { ... }
 * ```
 */
export const Timeout = (duration?: Duration): MethodDecorator & ClassDecorator => {
  return applyDecorators(ResilienceTimeout(duration), SetMetadata(LEGACY_TIMEOUT_METADATA_KEY, duration));
};

/** 别名导出 */
export const SetTimeout = Timeout;

/**
 * 声明控制器类或端点方法完全豁免请求超时拦截（适用于 SSE 长连接、WebSocket 升级等）
 *
 * 豁免应用层超时强杀预算，但底层网络断开连接（客户端 abort / close）时仍会触发 AbortSignal 协作取消。
 *
 * @example
 * ```typescript
 * @Get('stream')
 * @BypassTimeout()
 * streamEvents() { ... }
 * ```
 */
export const BypassTimeout = () => SetMetadata(BYPASS_TIMEOUT_KEY, true);

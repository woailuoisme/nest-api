import { SetMetadata } from '@nestjs/common';

/** 路由超时时间元数据 Key */
export const TIMEOUT_METADATA_KEY = 'COMMON:REQUEST_TIMEOUT_MS';

/** 超时豁免元数据 Key */
export const BYPASS_TIMEOUT_KEY = 'COMMON:BYPASS_TIMEOUT';

/**
 * 声明控制器类或端点方法的请求超时时间（毫秒）
 *
 * 设置为 `<= 0` 可禁用超时检测（适用于大文件上传、长耗时导出等流式端点）。
 *
 * @param ms 超时毫秒数
 *
 * @example
 * ```typescript
 * @Get('export')
 * @Timeout(60_000) // 60s
 * async exportReport() { ... }
 *
 * @Post('upload')
 * @Timeout(0) // 禁用超时
 * async uploadFile() { ... }
 * ```
 */
export const Timeout = (ms: number) => SetMetadata(TIMEOUT_METADATA_KEY, ms);

/** 别名导出 */
export const SetTimeout = Timeout;

/**
 * 声明控制器类或端点方法完全豁免请求超时拦截（适用于 SSE 长连接、WebSocket 升级等）
 *
 * 虽然豁免应用层超时定时强杀，但底层网络断开连接（客户端 abort / close）时仍会触发 AbortSignal 协作取消。
 *
 * @example
 * ```typescript
 * @Get('stream')
 * @BypassTimeout()
 * streamEvents() { ... }
 * ```
 */
export const BypassTimeout = () => SetMetadata(BYPASS_TIMEOUT_KEY, true);

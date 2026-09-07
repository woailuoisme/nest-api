import { SetMetadata } from '@nestjs/common';

export const BYPASS_TRANSFORM_KEY = 'bypass_transform';

/**
 * 跳过响应转换装饰器：标记路由接口跳过全局 TransformInterceptor 的 JSON 格式化包装（如文件下载、SSE数据流等）。
 */
export const BypassTransform = () => SetMetadata(BYPASS_TRANSFORM_KEY, true);

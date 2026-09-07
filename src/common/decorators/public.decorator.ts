import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 公开接口装饰器：用于将路由标注为公共接口（跳过 JwtAuthGuard 身份验证）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

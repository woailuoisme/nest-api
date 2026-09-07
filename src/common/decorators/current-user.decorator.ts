import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@/common/constants/roles';

export interface CurrentUserPayload {
  id: number;
  email?: string;
  role?: Role;
}

/**
 * 自定义参数装饰器：用于在 Controller 方法参数中获取当前登录用户对象 (`req.user`)。
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

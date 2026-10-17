import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Role } from '@/common/constants/roles';

export interface CurrentUserPayload {
  id: string;
  email: string;
  name?: string;
  role: Role;
  image?: string | null;
}

/**
 * 自定义参数装饰器：用于在 Controller 方法参数中获取当前登录用户对象 (`req.user`)。
 */
export const CurrentUser = createParamDecorator((data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as CurrentUserPayload | undefined;
  return data && user ? user[data] : user;
});

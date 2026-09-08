import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * 自定义参数装饰器：用于在 Controller 方法参数中获取 Better Auth Session 实体对象 (`req.session`)。
 */
export const Session = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.session;
});

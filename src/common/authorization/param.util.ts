import type { ExecutionContext } from '@nestjs/common';

/** 从路由参数读取 `@Can()` 的入参（与官方文档示例一致，返回元组） */
export const param =
  (name: string) =>
  (context: ExecutionContext): readonly [string] =>
    [context.switchToHttp().getRequest<{ params: Record<string, string> }>().params[name] as string] as const;

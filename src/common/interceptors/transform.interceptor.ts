import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { BYPASS_TRANSFORM_KEY } from '@/common/decorators/response.decorator';

/**
 * 全局成功响应拦截器：遵循 docs/api.md 工业级 RESTful 响应契约：
 * - 仅分页列表采用 `{"items": [...], "pagination": {...}}` 信封（空数据时保底为空数组 `[]`，杜绝前端空指针）
 * - 其余所有单资源、业务操作结果一律直接返回裸 JSON 业务对象，彻底废除无意义的 `{ data: ... }` / `{ success: ... }` 外层包装
 * - 204 No Content 保持 0 字节裸响应
 * - 支持通过 `@BypassTransform()` 装饰器跳过包装（如文件流、SSE、健康检查等）
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const bypass = this.reflector.getAllAndOverride<boolean>(BYPASS_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (bypass) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();

    return next.handle().pipe(
      map((data) => {
        // 204 No Content 响应无需包装，直接透传（由 Fastify 发送空 Body）
        if (response?.statusCode === 204) {
          return data;
        }

        // 分页对象自动归一化为标准的 items 与 pagination 信封
        if (data && typeof data === 'object' && 'items' in data) {
          const obj = data as { items: unknown; pagination?: unknown; meta?: unknown };
          if (obj.pagination || obj.meta) {
            return {
              items: Array.isArray(obj.items) ? obj.items : [],
              pagination: obj.pagination ?? obj.meta,
            };
          }
        }

        // 规范对齐：非分页单资源 / 业务操作结果，一律直接返回裸 JSON 对象
        return data;
      }),
    );
  }
}

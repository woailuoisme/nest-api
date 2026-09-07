import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { BYPASS_TRANSFORM_KEY } from '@/common/decorators/response.decorator';

export interface SuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * 全局成功响应拦截器：将所有 HTTP 成功响应统一格式化为纯正 RESTful JSON 结构：
 * - 单体资源：`{ data: T }`
 * - 分页列表：`{ data: T[], meta: PageMetaResource }`
 *
 * 协议状态完全由 HTTP Status Code (200 / 201 / 204) 表征，避免在 Body 内包裹冗余的 success/code/message。
 * 支持通过 `@BypassTransform()` 装饰器跳过包装（如文件流、SSE、健康检查等）。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<SuccessResponse<T> | T> {
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

        // 如果返回值是 PaginatedResultResource 或包含 items 与 meta 的分页对象，自动解构为顶级 data 与 meta
        if (data && typeof data === 'object' && 'items' in data && 'meta' in data) {
          const { items, meta } = data as { items: unknown; meta: unknown };
          return {
            data: items as T,
            meta: meta as Record<string, unknown>,
          };
        }

        return {
          data: (data ?? null) as T,
        };
      }),
    );
  }
}

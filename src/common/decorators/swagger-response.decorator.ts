import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import {
  ApiCursorPaginatedResponseResource,
  ApiErrorDetailsResource,
  ApiErrorResponseResource,
  ApiPaginatedResponseResource,
} from '@/common/dto/api-resource.dto';
import { CursorPageMetaResource, PageMetaResource } from '@/common/dto/pagination.dto';

export interface ApiSuccessResponseOptions {
  message?: string;
  description?: string;
  status?: number;
}

function resolveDescription(options: ApiSuccessResponseOptions, fallback: string): string {
  return options.description ?? options.message ?? fallback;
}

/**
 * Swagger 成功响应装饰器：自动生成符合系统统一 JSON 结构的 OpenAPI 成功响应文档。
 *
 * @param model 响应数据 DTO / Entity 类（可选）
 * @param options 可选配置（HTTP 状态码、文档描述）
 */
export function ApiSuccessResponse<TModel extends Type<unknown>>(
  model?: TModel,
  options: ApiSuccessResponseOptions = {},
) {
  const status = options.status ?? 200;
  const description = resolveDescription(options, 'Operation successful');

  // 204 No Content 响应无 Payload 实体
  if (status === 204) {
    return applyDecorators(
      ApiResponse({
        status: 204,
        description,
      }),
    );
  }

  if (!model) {
    return applyDecorators(
      ApiResponse({
        status,
        description,
        schema: {
          type: 'object',
          nullable: true,
          example: {},
        },
      }),
    );
  }

  // 规范对齐：非分页单资源直接返回裸 JSON 实体对象，彻底消除 { data: ... } 冗余包裹
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      type: model,
    }),
  );
}

/**
 * Swagger 无内容响应装饰器：生成 204 No Content 且无 Payload Body 的 OpenAPI 文档。
 *
 * @param options 可选配置（文档描述，默认 'No Content'）
 */
export function ApiNoContentResponse(options: ApiSuccessResponseOptions = {}) {
  const description = resolveDescription(options, 'No Content');

  return applyDecorators(
    ApiResponse({
      status: 204,
      description,
    }),
  );
}

/**
 * Swagger 偏移分页响应装饰器：自动生成符合系统统一 JSON 结构的 Offset 分页列表 OpenAPI 响应文档。
 *
 * @param model 列表项 DTO / Entity 类
 * @param options 可选配置（HTTP 状态码、文档描述）
 */
export function ApiPageResponse<TModel extends Type<unknown>>(model: TModel, options: ApiSuccessResponseOptions = {}) {
  const status = options.status ?? 200;
  const description = resolveDescription(options, 'Paginated list retrieved successfully');

  return applyDecorators(
    ApiExtraModels(ApiPaginatedResponseResource, PageMetaResource, model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          pagination: { $ref: getSchemaPath(PageMetaResource) },
        },
      },
    }),
  );
}

/**
 * Swagger 游标分页响应装饰器：自动生成符合系统统一 JSON 结构的 Cursor 游标分页列表 OpenAPI 响应文档。
 *
 * @param model 列表项 DTO / Entity 类
 * @param options 可选配置（HTTP 状态码、文档描述）
 */
export function ApiCursorPageResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: ApiSuccessResponseOptions = {},
) {
  const status = options.status ?? 200;
  const description = resolveDescription(options, 'Cursor paginated list retrieved successfully');

  return applyDecorators(
    ApiExtraModels(ApiCursorPaginatedResponseResource, CursorPageMetaResource, model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          pagination: { $ref: getSchemaPath(CursorPageMetaResource) },
        },
      },
    }),
  );
}

/**
 * Swagger 错误响应装饰器：生成符合系统统一 JSON 格式的错误响应 OpenAPI 文档。
 *
 * @param status HTTP 状态码（默认 422）
 * @param description 文档描述信息
 */
export function ApiErrorResponse(status = 422, description = 'Request failed or validation error') {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseResource, ApiErrorDetailsResource),
    ApiResponse({
      status,
      description,
      type: ApiErrorResponseResource,
    }),
  );
}

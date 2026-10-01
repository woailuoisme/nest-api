import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  ApiCursorPaginatedResponseResource,
  ApiErrorDetailsResource,
  ApiErrorResponseResource,
  ApiPaginatedResponseResource,
} from '@/common/dto/api-resource.dto';
import {
  CursorPageMetaResource,
  cursorPaginatedEnvelopeSchema,
  PageMetaResource,
  paginatedEnvelopeSchema,
} from '@/common/dto/pagination.dto';

/**
 * 响应模型：类（由 `@ApiProperty` 驱动文档）或 Standard Schema（Zod，Nest 12 原生通道）。
 *
 * 传 schema 时文档与运行时序列化（`@SerializeOptions({ schema })`）共用同一份契约；
 * 注意数组响应请显式传 `z.array(...)`，`isArray` 仅对类模型生效。
 */
export type ResponseModel = Type<unknown> | z.ZodType;

/** 判定是否为 Standard Schema（Zod 等库均实现 `~standard` 协议） */
export function isStandardSchema(model: ResponseModel): model is z.ZodType {
  return typeof model === 'object' && model !== null && '~standard' in model;
}

export interface ApiSuccessResponseOptions {
  message?: string;
  description?: string;
  status?: number;
  isArray?: boolean;
}

function resolveDescription(options: ApiSuccessResponseOptions, fallback: string): string {
  return options.description ?? options.message ?? fallback;
}

/** 分页响应信封共建配置：Offset 与 Cursor 分页仅元数据模型与默认描述不同 */
interface PaginatedResponseConfig {
  /** 分页元数据模型（PageMetaResource / CursorPageMetaResource） */
  metaModel: Type<unknown>;
  /** 分页信封模型，仅用于注册 OpenAPI Schema */
  metaWrapperModel: Type<unknown>;
  /** 未显式传描述时的兜底文案 */
  fallbackDescription: string;
}

/**
 * 分页响应共建函数：统一生成 { items, meta } 信封文档，确保两种分页形态结构永不漂移
 */
function buildPaginatedResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: ApiSuccessResponseOptions,
  config: PaginatedResponseConfig,
) {
  const status = options.status ?? 200;
  const description = resolveDescription(options, config.fallbackDescription);

  return applyDecorators(
    ApiExtraModels(config.metaWrapperModel, config.metaModel, model),
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
          meta: { $ref: getSchemaPath(config.metaModel) },
        },
      },
    }),
  );
}

/**
 * Swagger 成功响应装饰器：自动生成符合系统统一 JSON 结构的 OpenAPI 成功响应文档。
 *
 * @param model 响应数据模型：Entity 类或 Standard Schema（可选）
 * @param options 可选配置（HTTP 状态码、文档描述、数组形式）
 */
export function ApiSuccessResponse(model?: ResponseModel, options: ApiSuccessResponseOptions = {}) {
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

  // Standard Schema 通道：直接由 schema 转换出响应体文档
  if (isStandardSchema(model)) {
    return applyDecorators(
      ApiResponse({
        status,
        description,
        standardSchema: model,
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
      isArray: options.isArray,
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
export function ApiPageResponse(model: ResponseModel, options: ApiSuccessResponseOptions = {}) {
  if (isStandardSchema(model)) {
    return applyDecorators(
      ApiResponse({
        status: options.status ?? 200,
        description: resolveDescription(options, 'Paginated list retrieved successfully'),
        standardSchema: paginatedEnvelopeSchema(model),
      }),
    );
  }

  return buildPaginatedResponse(model, options, {
    metaModel: PageMetaResource,
    metaWrapperModel: ApiPaginatedResponseResource,
    fallbackDescription: 'Paginated list retrieved successfully',
  });
}

/**
 * Swagger 游标分页响应装饰器：自动生成符合系统统一 JSON 结构的 Cursor 游标分页列表 OpenAPI 响应文档。
 *
 * @param model 列表项 DTO / Entity 类
 * @param options 可选配置（HTTP 状态码、文档描述）
 */
export function ApiCursorPageResponse(model: ResponseModel, options: ApiSuccessResponseOptions = {}) {
  if (isStandardSchema(model)) {
    return applyDecorators(
      ApiResponse({
        status: options.status ?? 200,
        description: resolveDescription(options, 'Cursor paginated list retrieved successfully'),
        standardSchema: cursorPaginatedEnvelopeSchema(model),
      }),
    );
  }

  return buildPaginatedResponse(model, options, {
    metaModel: CursorPageMetaResource,
    metaWrapperModel: ApiCursorPaginatedResponseResource,
    fallbackDescription: 'Cursor paginated list retrieved successfully',
  });
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

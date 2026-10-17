import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CursorPageMetaResource, PageMetaResource } from './pagination.dto';

export class ApiResponseResource<T = unknown> {
  @ApiProperty({ description: 'Response payload data' })
  data: T;
}

export class ApiErrorDebugDetailsResource {
  @ApiProperty({
    example: 'UniqueViolationException',
    description: 'Exception class name (debug mode only)',
  })
  exception: string;

  @ApiProperty({
    type: [String],
    example: ['OrderService.ts:88', 'OrderController.ts:45'],
    description: 'Stack trace information (debug mode only)',
  })
  stack: string[];
}

export class ApiErrorDetailsResource {
  @ApiProperty({
    example: 'VALIDATION_FAILED',
    description: 'Machine-readable error code (e.g. VALIDATION_FAILED, NOT_FOUND, UNAUTHORIZED)',
  })
  code: string;

  @ApiProperty({ example: 'Validation failed', description: 'Human-readable error description' })
  message: string;

  @ApiPropertyOptional({
    example: {
      email: ['Email is required', 'Email format is invalid'],
      password: ['Password must be at least 8 characters'],
    },
    description: 'Validation error details per field',
  })
  fields?: Record<string, string[]>;

  @ApiPropertyOptional({
    type: ApiErrorDebugDetailsResource,
    description: 'Internal exception and stack trace (non-production and APP_DEBUG=true only)',
  })
  details?: ApiErrorDebugDetailsResource;
}

export class ApiErrorResponseResource {
  @ApiProperty({ type: ApiErrorDetailsResource, description: 'Error payload' })
  error: ApiErrorDetailsResource;
}

export class ApiPaginatedResponseResource<T = unknown> {
  @ApiProperty({ isArray: true, description: '列表数据集合（空数据时保底为空数组 []）' })
  items: T[];

  @ApiProperty({ type: PageMetaResource, description: 'Offset 分页元数据' })
  meta: PageMetaResource;
}

export class ApiCursorPaginatedResponseResource<T = unknown> {
  @ApiProperty({ isArray: true, description: '列表数据集合（空数据时保底为空数组 []）' })
  items: T[];

  @ApiProperty({ type: CursorPageMetaResource, description: 'Cursor 游标分页元数据' })
  meta: CursorPageMetaResource;
}

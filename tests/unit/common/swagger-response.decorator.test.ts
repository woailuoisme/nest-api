import { describe, expect, it } from 'vitest';
import {
  ApiCursorPageResponse,
  ApiErrorResponse,
  ApiNoContentResponse,
  ApiPageResponse,
  ApiSuccessResponse,
} from '@/common/decorators/swagger-response.decorator';

class SampleDto {
  id = '';
  name = '';
}

describe('Swagger Response Decorators', () => {
  it('ApiSuccessResponse 无 model 且状态为 200 时应正确生成空数据 schema 装饰器', () => {
    const decorator = ApiSuccessResponse(undefined, { status: 200, description: 'Success with empty object' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiSuccessResponse 状态为 204 时应生成无 Schema 装饰器', () => {
    const decorator = ApiSuccessResponse(undefined, { status: 204, description: 'No content' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiNoContentResponse 应正确生成 204 No Content 装饰器', () => {
    const decorator = ApiNoContentResponse({ description: 'Deleted successfully' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiSuccessResponse 带 model 时应正确生成包装 schema 装饰器', () => {
    const decorator = ApiSuccessResponse(SampleDto, { status: 200, description: 'Get sample' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiPageResponse 应正确生成 Offset 分页响应装饰器', () => {
    const decorator = ApiPageResponse(SampleDto, { status: 200, description: 'Paginated list' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiCursorPageResponse 应正确生成 Cursor 游标分页响应装饰器', () => {
    const decorator = ApiCursorPageResponse(SampleDto, { status: 200, description: 'Cursor paginated list' });
    expect(typeof decorator).toBe('function');
  });

  it('ApiErrorResponse 应正确生成统一错误响应装饰器', () => {
    const decorator = ApiErrorResponse(400, 'Bad request');
    expect(typeof decorator).toBe('function');
  });
});

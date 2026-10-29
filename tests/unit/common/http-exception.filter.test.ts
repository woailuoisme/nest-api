import {
  type ArgumentsHost,
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { HttpExceptionFilter, resolveErrorEnvelope } from '@/common/filters/http-exception.filter';

/** 共享 mock host 工厂：捕获过滤器写入的 statusCode 与响应体 */
const createMockHost = (url = '/v1/test') => {
  const state: { statusCode: number | null; responseBody: any; headers: Record<string, string> } = {
    statusCode: null,
    responseBody: null,
    headers: {},
  };

  const mockResponse = {
    header: (name: string, value: string) => {
      state.headers[name] = value;
      return mockResponse;
    },
    code: (code: number) => {
      state.statusCode = code;
      return {
        send: (body: any) => {
          state.responseBody = body;
        },
      };
    },
  };

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => ({ url, headers: {} }),
    }),
  } as unknown as ArgumentsHost;

  return { host, state };
};

describe('resolveErrorEnvelope 纯函数', () => {
  it('应将标准 HttpException 解析为 { status, body } 且不产生日志意图', () => {
    const result = resolveErrorEnvelope(new BadRequestException('Invalid request parameters'));

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request parameters' },
    });
    expect(result.log).toBeUndefined();
  });

  it('应聚合校验错误字段为 fields 并转码 VALIDATION_FAILED', () => {
    const exception = new UnprocessableEntityException({
      message: 'Validation failed',
      errors: { email: ['The email field is required.'] },
    });

    const result = resolveErrorEnvelope(exception);

    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
    expect(result.body.error.fields).toEqual({ email: ['The email field is required.'] });
    expect(result.log).toBeUndefined();
  });

  it('debug=false 时应脱敏内部异常 message 且返回 error 级日志意图（含 stack）', () => {
    const result = resolveErrorEnvelope(new Error('db connection refused: postgres://secret@10.0.0.5/internal'), false);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(result.log).toMatchObject({ level: 'error' });
    expect(result.log?.message).toContain('db connection refused');
    expect(result.log?.stack).toBeDefined();
  });

  it('debug=true 时应暴露内部 message 与 details（exception/stack）', () => {
    const result = resolveErrorEnvelope(new Error('boom: internal detail'), true);

    const error = result.body.error as Record<string, any>;
    expect(error.message).toBe('boom: internal detail');
    expect(error.details.exception).toBe('Error');
    expect(error.details.stack.length).toBeGreaterThan(0);
  });

  it('应将 PG 唯一键冲突（23505）转译为 409 且返回 warn 级日志意图', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

    const result = resolveErrorEnvelope(pgError);

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'CONFLICT', message: '数据已存在，请勿重复操作' },
    });
    expect(result.log).toMatchObject({ level: 'warn' });
  });

  it('应支持经 cause.code 携带的 PG 错误码转译', () => {
    const wrapped = Object.assign(new Error('invalid input syntax for type integer'), {
      cause: { code: '22P02' },
    });

    const result = resolveErrorEnvelope(wrapped);

    expect(result.status).toBe(400);
    expect(result.body.error.message).toBe('数据格式或参数类型无效');
  });

  it('对非 Error 抛出应返回 500 通用信封与不含 stack 的日志意图', () => {
    const result = resolveErrorEnvelope('plain string throw');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(result.log?.message).toContain('plain string throw');
    expect(result.log?.stack).toBeUndefined();
  });
});

describe('HttpExceptionFilter 集成', () => {
  it('should format HttpException into standard { error: { code, message } } response', () => {
    const filter = new HttpExceptionFilter();
    const { host, state } = createMockHost();

    filter.catch(new BadRequestException('Invalid request parameters'), host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request parameters',
      },
    });
  });

  it('健康探针报告（Terminus 载荷）应原样透出，不被统一信封丢弃逐探针明细', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/readyz');

    const healthReport = {
      status: 'error',
      info: { database: { status: 'up' } },
      error: { shutdown: { status: 'down' } },
      details: { shutdown: { status: 'down' } },
    };

    filter.catch(new ServiceUnavailableException(healthReport), host);

    expect(state.statusCode).toBe(503);
    expect(state.responseBody).toEqual(healthReport);
  });

  it('常规 503 异常仍走统一信封（`error` 为字符串时不误判为健康报告）', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/orders');

    filter.catch(new ServiceUnavailableException('依赖服务不可用'), host);

    expect(state.statusCode).toBe(503);
    expect(state.responseBody).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '依赖服务不可用',
      },
    });
  });

  it('should format UnprocessableEntityException with validation fields map and VALIDATION_FAILED code', () => {
    const filter = new HttpExceptionFilter();
    const { host, state } = createMockHost('/v1/users');

    const exception = new UnprocessableEntityException({
      message: 'Validation failed',
      errors: {
        email: ['The email field is required.'],
      },
    });

    filter.catch(exception, host);

    expect(state.statusCode).toBe(422);
    expect(state.responseBody).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields: {
          email: ['The email field is required.'],
        },
      },
    });
  });

  it('should not leak internal error message or stack trace when APP_DEBUG is false', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost();

    filter.catch(new Error('db connection refused: postgres://secret@10.0.0.5/internal'), host);

    expect(state.statusCode).toBe(500);
    expect(state.responseBody).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal Server Error',
      },
    });
  });

  it('should expose internal message, exception name and stack trace under details when APP_DEBUG is true', () => {
    const filter = new HttpExceptionFilter(true);
    const { host, state } = createMockHost();

    filter.catch(new Error('db connection refused: postgres://secret@10.0.0.5/internal'), host);

    expect(state.statusCode).toBe(500);
    expect(state.responseBody.error.message).toBe('db connection refused: postgres://secret@10.0.0.5/internal');
    expect(state.responseBody.error.details).toBeDefined();
    expect(state.responseBody.error.details.exception).toBe('Error');
    expect(state.responseBody.error.details.stack).toBeDefined();
    expect(state.responseBody.error.details.stack.length).toBeGreaterThan(0);
  });

  it('should automatically map PostgreSQL unique_violation (23505) to 409 Conflict', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/users');

    const pgUniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (email)=(test@example.com) already exists.',
    });

    filter.catch(pgUniqueError, host);

    expect(state.statusCode).toBe(409);
    expect(state.responseBody).toEqual({
      error: {
        code: 'CONFLICT',
        message: '数据已存在，请勿重复操作',
      },
    });
  });

  it('should automatically map PostgreSQL foreign_key_violation (23503) to 400 Bad Request', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/users');

    const pgFkError = Object.assign(new Error('insert or update on table violates foreign key constraint'), {
      code: '23503',
    });

    filter.catch(pgFkError, host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: '关联引用的目标数据不存在或无法关联',
      },
    });
  });

  it('should automatically map PostgreSQL not_null_violation (23502) to 400 Bad Request', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/users');

    const pgNotNullError = Object.assign(new Error('null value in column violates not-null constraint'), {
      code: '23502',
    });

    filter.catch(pgNotNullError, host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: '缺少必填的数据字段',
      },
    });
  });

  it('should automatically map PostgreSQL invalid_text_representation (22P02) to 400 Bad Request', () => {
    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/users');

    const pgInvalidTypeError = Object.assign(new Error('invalid input syntax for type integer'), {
      cause: { code: '22P02' },
    });

    filter.catch(pgInvalidTypeError, host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: '数据格式或参数类型无效',
      },
    });
  });

  it('英文翻译器下 PG 唯一键冲突应转译为英文提示', () => {
    const translator = (key: string) =>
      key === 'db.uniqueViolation' ? 'Data already exists, please do not duplicate operation' : key;
    const filter = new HttpExceptionFilter(false, translator as never);
    const { host, state } = createMockHost('/v1/users');

    const pgUniqueError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    filter.catch(pgUniqueError, host);

    expect(state.statusCode).toBe(409);
    expect(state.responseBody).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Data already exists, please do not duplicate operation',
      },
    });
  });

  it('当 HttpException 携带 i18nKey 时，过滤器应自动本地化转译消息', () => {
    const translator = (key: string) => (key === 'auth.loginFailed' ? 'Invalid credentials' : key);
    const filter = new HttpExceptionFilter(false, translator as never);
    const { host, state } = createMockHost('/v1/auth/login');

    const exception = new BadRequestException({
      message: '用户名或密码错误',
      i18nKey: 'auth.loginFailed',
    });

    filter.catch(exception, host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody.error.message).toBe('Invalid credentials');
  });

  it('当 HttpException message 本身为多语言 Key 时，过滤器应自动转译', () => {
    const translator = (key: string) => (key === 'common.notFound' ? 'Requested resource not found' : key);
    const filter = new HttpExceptionFilter(false, translator as never);
    const { host, state } = createMockHost('/v1/items/999');

    filter.catch(new BadRequestException('common.notFound'), host);

    expect(state.statusCode).toBe(400);
    expect(state.responseBody.error.message).toBe('Requested resource not found');
  });

  it('异常携带 headers 时应写回响应头（幂等 409 的 Retry-After）', () => {
    class RetryableException extends BadRequestException {
      readonly headers = { 'Retry-After': '2' };
    }

    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/orders');

    filter.catch(new RetryableException('busy'), host);

    expect(state.headers).toEqual({ 'Retry-After': '2' });
  });

  it('异常 headers 中的非字符串值应被忽略，不得写入响应头', () => {
    class WeirdException extends BadRequestException {
      readonly headers = { 'X-Num': 1 as unknown as string, 'Retry-After': '3' };
    }

    const filter = new HttpExceptionFilter(false);
    const { host, state } = createMockHost('/v1/orders');

    filter.catch(new WeirdException('busy'), host);

    expect(state.headers).toEqual({ 'Retry-After': '3' });
  });
});

import type { ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { isEmptyObject } from 'es-toolkit';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface HttpResponse {
  code?: (statusCode: number) => HttpResponse;
  status?: (statusCode: number) => HttpResponse;
  send?: (body: unknown) => void;
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  end?: (chunk: string) => void;
}

/** PostgreSQL 常见约束错误码转译映射表 */
const PG_ERROR_MAP: Record<string, { status: HttpStatus; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: '数据已存在，请勿重复操作' }, // unique_violation
  '23503': { status: HttpStatus.BAD_REQUEST, message: '关联引用的目标数据不存在或无法关联' }, // foreign_key_violation
  '23502': { status: HttpStatus.BAD_REQUEST, message: '缺少必填的数据字段' }, // not_null_violation
  '22P02': { status: HttpStatus.BAD_REQUEST, message: '数据格式或参数类型无效' }, // invalid_text_representation
};

/** 日志意图：由 resolveErrorEnvelope 判定「是否记录与记录什么」，交由过滤器附加请求上下文后执行 */
export interface ResolvedErrorLog {
  level: 'warn' | 'error';
  message: string;
  stack?: string;
}

/** 将任意未知异常解析为标准 ErrorEnvelope 的结果 */
export interface ResolvedError {
  status: HttpStatus;
  body: { error: Record<string, unknown> };
  log?: ResolvedErrorLog;
}

/**
 * 纯函数：将任意未知异常解析为标准 ErrorEnvelope 响应（零副作用、无 I/O）：
 * `{ error: { code: 'NOT_FOUND', message: string, fields?: Record<string, string[]>, details?: { exception: string, stack: string[] } } }`。
 *
 * `code` 为 SCREAMING_SNAKE_CASE 格式业务/HTTP状态码字符串（如 'VALIDATION_FAILED'、'NOT_FOUND'、'UNAUTHORIZED'）。
 * 自动解析表单/DTO 校验错误字段并聚合为 `fields` 字典，并在 `debug=true` 时附加 `details: { exception, stack }` 调试信息
 * （类似 Laravel `APP_DEBUG`，生产环境必须为 false，防止泄漏内部 SQL、代码逻辑与堆栈）。
 * 需要记录日志时通过返回值的 `log` 意图声明（PG 转译为 warn，未捕获异常为 error），由调用方执行。
 * @param debug 是否输出调试信息（exception/trace 及内部异常 message），对应 APP_DEBUG
 */
export function resolveErrorEnvelope(exception: unknown, debug = false): ResolvedError {
  let status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

  let message = 'Internal Server Error';
  let errors: Record<string, string[]> | undefined;
  let code = HttpStatus[status] ?? String(status);
  let log: ResolvedErrorLog | undefined;

  if (exception instanceof HttpException) {
    const res = exception.getResponse();

    if (typeof res === 'string') {
      message = res;
    } else if (typeof res === 'object' && res !== null) {
      const resObj = res as Record<string, unknown>;
      if (typeof resObj.code === 'string') {
        code = resObj.code;
      }

      if (typeof resObj.message === 'string') {
        message = resObj.message;
      } else if (Array.isArray(resObj.message)) {
        message = (resObj.error as string) ?? 'Validation failed';
      } else {
        message = exception.message;
      }

      // Extract field validation errors
      if (resObj.errors && typeof resObj.errors === 'object') {
        errors = resObj.errors as Record<string, string[]>;
      } else if (resObj.fields && typeof resObj.fields === 'object') {
        errors = resObj.fields as Record<string, string[]>;
      } else if (Array.isArray(resObj.message)) {
        errors = formatValidationMessages(resObj.message as string[]);
      }

      if (errors && !isEmptyObject(errors) && typeof resObj.code !== 'string') {
        code = 'VALIDATION_FAILED';
      }
    }
  } else {
    const dbError = extractDatabaseError(exception);
    if (dbError) {
      status = dbError.status;
      message = dbError.message;
      code = HttpStatus[status] ?? String(status);
      log = { level: 'warn', message: `Database constraint mapped to HTTP ${status}: ${message}` };
    } else if (exception instanceof Error) {
      // 脱敏：debug=false 时不向客户端透出内部异常 message（可能含 SQL/堆栈/内网信息），仅返回通用文案
      message = debug ? exception.message : 'Internal Server Error';
      code = HttpStatus[status] ?? String(status);
      log = { level: 'error', message: `Unhandled Exception: ${exception.message}`, stack: exception.stack };
    } else {
      log = { level: 'error', message: `Unhandled Exception: ${String(exception)}` };
    }
  }

  const errorPayload: Record<string, unknown> = {
    code,
    message,
  };

  if (errors && !isEmptyObject(errors)) {
    errorPayload.fields = errors;
  }

  if (debug && exception instanceof Error) {
    errorPayload.details = {
      exception: exception.constructor.name,
      stack: exception.stack ? exception.stack.split('\n').map((line) => line.trim()) : [],
    };
  }

  return { status, body: { error: errorPayload }, log };
}

/** 将框架校验错误消息数组按字段名聚合 */
function formatValidationMessages(messages: string[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const msg of messages) {
    if (typeof msg === 'string') {
      const fieldMatch = msg.match(/^([a-zA-Z0-9_]+)\s+/);
      const field = fieldMatch?.[1] ?? 'general';
      errors[field] ??= [];
      errors[field].push(msg);
    }
  }
  return errors;
}

/**
 * 智能识别 PostgreSQL / Drizzle 驱动常见约束异常码并转译为业务友好的 HTTP 状态
 */
function extractDatabaseError(exception: unknown): { status: HttpStatus; message: string } | null {
  if (!exception || typeof exception !== 'object') {
    return null;
  }

  const err = exception as { code?: string; cause?: { code?: string } };
  const pgCode = err.code ?? err.cause?.code;

  if (!pgCode) {
    return null;
  }

  return PG_ERROR_MAP[pgCode] ?? null;
}

/**
 * 全局异常过滤器：捕获所有未处理的 HTTP 及系统异常，委托 {@link resolveErrorEnvelope} 完成
 * 转译与脱敏，随后执行日志意图并按当前响应对象形态（Fastify / raw ServerResponse）写回。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  #logger = new Logger(HttpExceptionFilter.name);

  /** @param debug 是否输出调试信息（exception/trace 及内部异常 message），对应 APP_DEBUG */
  constructor(private readonly debug = false) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply | ServerResponse>() as unknown as HttpResponse;
    const request = ctx.getRequest<FastifyRequest>();

    const { status, body, log } = resolveErrorEnvelope(exception, this.debug);

    if (log) {
      const line = `${log.message} at ${request?.url ?? ''}`;
      if (log.level === 'warn') {
        this.#logger.warn(line);
      } else {
        this.#logger.error(line, log.stack);
      }
    }

    if (typeof response.code === 'function') {
      response.code(status).send?.(body);
    } else if (typeof response.status === 'function') {
      response.status(status).send?.(body);
    } else {
      response.statusCode = status;
      response.setHeader?.('Content-Type', 'application/json');
      response.end?.(JSON.stringify(body));
    }
  }
}

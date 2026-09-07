import {
  ClassSerializerInterceptor,
  type PipeTransform,
  type Type,
  UnprocessableEntityException,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createZodValidationPipe } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { MultipartInterceptor } from '@/common/interceptors/multipart.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { EnvConfig } from '@/config/env.validation';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';

/** 统一格式化的 Zod 校验管道：输出 422 UnprocessableEntityException 契约响应 */
export const CustomZodValidationPipe: Type<PipeTransform> = createZodValidationPipe({
  createValidationException: (error: unknown) => {
    const formattedErrors: Record<string, string[]> = {};
    const zodError = error as ZodError;
    if (zodError && Array.isArray(zodError.issues)) {
      for (const issue of zodError.issues) {
        const field = issue.path.join('.') || 'root';
        if (!formattedErrors[field]) {
          formattedErrors[field] = [];
        }
        formattedErrors[field].push(issue.message);
      }
    }
    return new UnprocessableEntityException({
      message: 'Validation failed',
      errors: formattedErrors,
    });
  },
});

/** 配置全局中间件、版本控制、验证管道、异常过滤器与拦截器 */
export function setupGlobalMiddleware(app: NestFastifyApplication): void {
  app.useLogger(app.get(PinoLoggerService));
  app.enableCors();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(new CustomZodValidationPipe());

  app.useGlobalFilters(new HttpExceptionFilter(app.get(ConfigService<EnvConfig, true>).get('APP_DEBUG')));

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new TransformInterceptor(reflector),
    new ClassSerializerInterceptor(reflector),
    new MultipartInterceptor(reflector),
  );
}

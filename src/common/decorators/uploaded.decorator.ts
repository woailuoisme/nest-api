import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  UPLOAD_OPTIONS_KEY,
  UPLOADED_FILES_KEY,
  type UploadedFile as UploadedFilePayload,
  type UploadOptions,
} from '@/common/storage/interfaces/upload.interface';

/**
 * 上传参数装饰器工厂 — 收敛 @UploadedFile 与 @UploadedFiles 的重复实现。
 *
 * 装饰器承担双重职责：
 * 1. 将 UploadOptions 写入方法 metadata → 触发全局 MultipartInterceptor 收集流并做可选校验；
 * 2. 从 request 上读取收集好的 UploadedFile[]，注入被装饰的参数。
 *
 * @param single true → 单文件（取 files[0]，无文件为 undefined）；false → 多文件（files，无文件为空数组）
 */
export function createUploadedDecorator(single: boolean): (options?: UploadOptions) => ParameterDecorator {
  return (options?: UploadOptions) =>
    (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      // metadata 挂到方法函数上（与 NestJS 方法装饰器挂载点一致），MultipartInterceptor 才能经 Reflector 读取
      const handler = (target as Record<string, unknown>)[propertyKey as string] as object;
      Reflect.defineMetadata(UPLOAD_OPTIONS_KEY, options ?? {}, handler);
      // options 仅用于 metadata，不传给参数注入器（data 参数无实际用途）
      createParamDecorator(
        (_data: unknown, ctx: ExecutionContext): UploadedFilePayload | UploadedFilePayload[] | undefined => {
          const req = ctx.switchToHttp().getRequest<FastifyRequest>();
          const files = Reflect.get(req, UPLOADED_FILES_KEY) as UploadedFilePayload[] | undefined;
          return single ? files?.[0] : (files ?? []);
        },
      )()(target, propertyKey, parameterIndex);
    };
}

/**
 * 单文件上传参数装饰器。用法：
 * ```ts
 * upload(@UploadedFile({ maxSize, allowedMime, allowedExt }) file: UploadedFile)
 * ```
 * 无文件时注入 undefined。
 */
export const UploadedFile = createUploadedDecorator(true);

/**
 * 多文件上传参数装饰器。用法：
 * ```ts
 * uploadMany(@UploadedFiles({ maxSize }) files: UploadedFile[])
 * ```
 * 无文件时注入空数组。
 */
export const UploadedFiles = createUploadedDecorator(false);

import { extname } from 'node:path';
import type { Readable } from 'node:stream';

import { BadRequestException } from '@nestjs/common';
import type {
  IncomingMultipartFile,
  MultipartFileStream,
  UploadedMultipartFile,
} from '@nestjs/platform-fastify/multipart';

/**
 * 上传文件统一载荷 — 由 `@nestjs/platform-fastify/multipart` 的原生拦截器产出
 * （`FileInterceptor` / `FilesInterceptor` / `AnyFilesInterceptor` / `FileStreamInterceptor`）。
 *
 * 两种模式（可辨识联合）：
 * - 内存模式（默认，`buffer` 存在）：整文件驻留内存，`size` 精确可用；
 * - 流式模式（`FileStreamInterceptor`）：边读边处理，O(1) 内存，超出 `limits.fileSize` 时
 *   原生实现会以 `PayloadTooLargeException` 中断流（413），无需调用方判截断标记。
 */
export type UploadedFile = MemoryUpload | MultipartFileStream;

/** 内存模式载荷（`buffer` 必然存在，`size` 精确可用） */
export type MemoryUpload = UploadedMultipartFile & { buffer: Buffer };

/** 是否为内存模式载荷（携带完整 `buffer` 与精确 `size`） */
export function isMemoryUpload(file: UploadedFile): file is MemoryUpload {
  return 'buffer' in file && Buffer.isBuffer(file.buffer);
}

/** 是否为流式载荷（`stream` 可用，且只能消费一次） */
export function isStreamUpload(file: UploadedFile): file is MultipartFileStream {
  return 'stream' in file;
}

/** 取载荷内容：内存模式为 Buffer，流式模式为可读流（调用方须自行消费/落盘） */
export function getUploadContent(file: UploadedFile): Buffer | Readable {
  return isStreamUpload(file) ? file.stream : file.buffer;
}

/** 单次上传的可选校验规则（由拦截器 fileFilter 消费） */
export interface UploadValidationOptions {
  /** 允许的 MIME 类型白名单（比对统一小写，大小写不敏感） */
  allowedMime?: readonly string[];
  /** 允许的扩展名白名单（含点号，如 ['.png', '.jpg']） */
  allowedExt?: readonly string[];
}

/**
 * 构造原生 multipart `fileFilter`：按 MIME / 扩展名白名单校验，违规以 `BadRequestException` 中断请求。
 *
 * 大小上限不在此处校验 — 交由拦截器 `limits.fileSize` 在流式写入过程中强制（超限即 413），
 * 避免把超大文件先读入内存再判断。
 */
export function createUploadFileFilter(options: UploadValidationOptions) {
  return (
    _req: unknown,
    file: IncomingMultipartFile,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ): void => {
    const { allowedMime, allowedExt } = options;

    if (allowedMime?.length && !allowedMime.some((m) => m.toLowerCase() === file.mimetype.toLowerCase())) {
      callback(
        new BadRequestException(`不支持的 MIME 类型: ${file.mimetype} (允许: ${allowedMime.join(', ')})`),
        false,
      );
      return;
    }

    if (allowedExt?.length) {
      const ext = extname(file.originalname).toLowerCase();
      if (!allowedExt.includes(ext)) {
        callback(new BadRequestException(`不支持的扩展名: ${ext} (允许: ${allowedExt.join(', ')})`), false);
        return;
      }
    }

    callback(null, true);
  };
}

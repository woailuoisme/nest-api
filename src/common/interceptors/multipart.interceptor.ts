import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { finalize, type Observable } from 'rxjs';
import { PATHS } from '@/common/constants/app.constants';
import {
  UPLOAD_OPTIONS_KEY,
  UPLOADED_FILES_KEY,
  type UploadedFile,
  type UploadOptions,
} from '@/common/storage/interfaces/upload.interface';

/** multipart part 的结构（fastify-multipart 类型推导不便，内联最小契约） */
interface MultipartPart {
  type: 'file' | 'field';
  fieldname: string;
  filename: string;
  mimetype: string;
  file: Readable & { truncated?: boolean };
}

/** 挂载 fastify-multipart tmpUploads（onResponse 钩子据其兜底清理）的请求类型 */
type MultipartRequest = FastifyRequest & { tmpUploads?: { filepath?: string }[] };

/**
 * Fastify multipart 拦截器 — 将 `req.files()` 异步流统一收集为 `UploadedFile[]` 挂到 request 上，
 * 供 @UploadedFile / @UploadedFiles 参数装饰器取用。
 *
 * 触发条件：handler 上存在 `UPLOAD_OPTIONS_KEY` metadata（由装饰器写入）。
 * 未标记的路由直接放行，不影响非上传请求。
 *
 * 收集模式：
 * - 内存模式（默认）：整文件读入 buffer，可精确校验 maxSize；
 * - 流式模式（streamToDisk）：循环内立即 pipeline 到 PATHS.STORAGE_TMP/<uuid>，解除 busboy 回压
 *   （@fastify/multipart 单遍 + 强回压，流不消费会让解析暂停、请求挂起），
 *   截断检测延迟到 MediaService 写盘完成后（truncated 标记）。
 *
 * 清理策略（三层兜底，均幂等）：
 * 1. 收集失败（如 413）→ 当前文件的 tmp 由 #streamToTmp 失败路径自删，已写文件由 catch 清理；
 * 2. 校验失败 → catch 清理全部 tmp；
 * 3. handler 完成后（无论成败）→ finalize 清理未被 MediaService 消费的 tmp；
 *    另将 tmpPath 挂入 request.tmpUploads，由 fastify-multipart 的 onResponse 钩子二次兜底。
 *
 * 校验：可选。装饰器传入 UploadOptions 时按 maxSize / allowedMime / allowedExt 校验，违规抛 BadRequestException。
 * 不传则只收集不校验（工具只做存盘，校验由调用方负责）。
 */
@Injectable()
export class MultipartInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MultipartInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.get<UploadOptions | undefined>(UPLOAD_OPTIONS_KEY, context.getHandler());
    // 非上传路由 → 直接放行
    if (options === undefined) return next.handle();

    const req = context.switchToHttp().getRequest<MultipartRequest>();
    const files = await this.#collectFiles(req, options?.streamToDisk === true);
    try {
      this.#validate(files, options ?? {});
    } catch (err) {
      // 校验失败 → 清理已写 tmp 后重抛，避免孤儿文件
      await this.#cleanupUnusedTmp(files);
      throw err;
    }

    // 挂载到 request 供参数装饰器读取
    Reflect.set(req, UPLOADED_FILES_KEY, files);
    // handler 完成（无论成败）后清理未被消费的 tmp 文件 — 与 MediaService 消费即删互补
    return next.handle().pipe(finalize(() => void this.#cleanupUnusedTmp(files)));
  }

  /**
   * 从 Fastify multipart 请求收集所有文件为 UploadedFile[]。
   * - 内存模式（默认）：整文件收集为 Buffer，可精确校验大小，检测截断并抛 413；
   * - 流式模式（streamToDisk）：循环内立即把流写盘到 PATHS.STORAGE_TMP/<uuid>，保证 busboy 不被阻塞，
   *   截断仅记录标记，由 MediaService 写盘完成后判定。
   */
  async #collectFiles(req: MultipartRequest, streamToDisk: boolean): Promise<UploadedFile[]> {
    // 请求 Content-Type 非 multipart/form-data 时立即返回 400，防止 busboy 内部异常透出 500
    const multipartReq = req as FastifyRequest & { isMultipart?: () => boolean };
    if (typeof multipartReq.isMultipart === 'function' && !multipartReq.isMultipart()) {
      throw new BadRequestException('上传请求的 Content-Type 必须为 multipart/form-data');
    }
    const files: UploadedFile[] = [];
    const parts = req.files();
    try {
      for await (const part of parts) {
        // 跳过非文件字段（普通表单字段）
        if (part.type !== 'file') continue;

        if (streamToDisk) {
          const file = await this.#streamToTmp(part);
          // 挂入 fastify-multipart 的 tmpUploads，响应结束后由 cleanRequestFiles 兜底清理
          req.tmpUploads ??= [];
          req.tmpUploads.push({ filepath: file.tmpPath });
          files.push(file);
          continue;
        }

        const buffer = await this.#streamToBuffer(part.file);
        // 流被截断 → 超出全局 fileSize 限制
        if (part.file.truncated) {
          throw new PayloadTooLargeException(`文件 ${part.filename} 超出大小上限`);
        }

        files.push({
          type: 'memory',
          fieldname: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer,
          size: buffer.byteLength,
        });
      }
    } catch (err) {
      // 收集中途失败（如 413）→ 清理已写 tmp 后重抛，避免孤儿文件
      await this.#cleanupUnusedTmp(files);
      throw err;
    }
    return files;
  }

  /**
   * 流式模式核心 — 立即把 multipart 文件流 pipeline 到临时文件。
   * 必须在循环内同步消费流，否则 busboy 缓冲填满后暂停解析，finish 永不触发，请求挂起。
   */
  async #streamToTmp(part: MultipartPart): Promise<Extract<UploadedFile, { type: 'stream' }>> {
    const tmpPath = join(PATHS.STORAGE_TMP, randomUUID());
    await fs.mkdir(PATHS.STORAGE_TMP, { recursive: true });
    try {
      await pipeline(part.file, createWriteStream(tmpPath));
    } catch (err) {
      // 写盘中失败（如全局 fileSize 截断触发源流销毁）→ 删除部分写入的 tmp，避免孤儿文件
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
    return {
      type: 'stream',
      fieldname: part.fieldname,
      filename: part.filename,
      mimetype: part.mimetype,
      tmpPath,
      truncated: part.file.truncated === true,
    };
  }

  /** 将 Readable 流收集为 Buffer */
  async #streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * 按 UploadOptions 校验文件列表。任一文件违规即抛异常。
   * 全部为可选校验项，未配置则跳过对应检查。
   */
  #validate(files: UploadedFile[], options: UploadOptions): void {
    if (options.maxSize === undefined && !options.allowedMime?.length && !options.allowedExt?.length) return;

    for (const file of files) {
      // size 仅在内存模式可用；流式模式无 size，由全局 limits 截断兜底
      if (options.maxSize !== undefined && file.type === 'memory' && file.size > options.maxSize) {
        throw new BadRequestException(
          `文件 ${file.filename} 大小 ${(file.size / 1024).toFixed(1)}KB 超出上限 ${(options.maxSize / 1024).toFixed(1)}KB`,
        );
      }
      // MIME 比对统一小写，大小写不敏感
      if (
        options.allowedMime?.length &&
        !options.allowedMime.some((m) => m.toLowerCase() === file.mimetype.toLowerCase())
      ) {
        throw new BadRequestException(`不支持的 MIME 类型: ${file.mimetype} (允许: ${options.allowedMime.join(', ')})`);
      }
      if (options.allowedExt?.length) {
        const ext = extname(file.filename).toLowerCase();
        if (!options.allowedExt.includes(ext)) {
          throw new BadRequestException(`不支持的扩展名: ${ext} (允许: ${options.allowedExt.join(', ')})`);
        }
      }
    }
  }

  /** 幂等清理未消费的 tmp 文件（ENOENT 视为已消费/已删，忽略） */
  async #cleanupUnusedTmp(files: UploadedFile[]): Promise<void> {
    await Promise.all(
      files.map(async (file) => {
        if (file.type !== 'stream') return;
        try {
          await fs.unlink(file.tmpPath);
        } catch (err: unknown) {
          if (!isNodeError(err) || err.code !== 'ENOENT') {
            this.logger.warn(`清理上传临时文件失败: ${file.tmpPath}`);
          }
        }
      }),
    );
  }
}

/** 判断 err 是否为 NodeJS 系统错误（带 code 属性） */
const isNodeError = (err: unknown): err is NodeJS.ErrnoException => err instanceof Error && 'code' in err;

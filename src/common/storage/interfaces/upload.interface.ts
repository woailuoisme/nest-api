/**
 * 上传文件统一结构 — 由 MultipartInterceptor 从 Fastify multipart 流收集而来，
 * 作为 controller / service 层流转的标准载荷。
 *
 * 可辨识联合，两种模式（二选一）：
 * - 内存模式（默认）：整个文件读入 buffer，size 精确可用，可做 maxSize 校验
 * - 流式模式（streamToDisk）：边收边写入 PATHS.STORAGE_TMP/<uuid>，载荷携带 tmpPath，
 *   MediaService.save 再流式搬到最终路径，O(1) 内存避免大文件 OOM
 */
export type UploadedFile =
  | {
      /** 载荷模式：内存模式 */
      type: 'memory';
      /** 表单字段名 */
      fieldname: string;
      /** 原始文件名（client 提供，未校验） */
      filename: string;
      /** MIME 类型（client 提供，未校验） */
      mimetype: string;
      /** 文件内容（整体驻留内存） */
      buffer: Buffer;
      /** 文件大小（字节）— 精确可用 */
      size: number;
    }
  | {
      /** 载荷模式：流式模式 */
      type: 'stream';
      /** 表单字段名 */
      fieldname: string;
      /** 原始文件名（client 提供，未校验） */
      filename: string;
      /** MIME 类型（client 提供，未校验） */
      mimetype: string;
      /** 已落盘的临时文件路径（PATHS.STORAGE_TMP/<uuid>），消费完毕后应删除 */
      tmpPath: string;
      /** 全局 limits 截断标记 — 写盘完成后由消费方据此判定超限 */
      truncated?: boolean;
    };

/**
 * 装饰器 / 拦截器层可选校验选项。
 * 不传时工具只透传不校验；传则在 MultipartInterceptor 中按项校验，违规抛 BadRequestException。
 */
export interface UploadOptions {
  /** 单文件大小上限（字节）— 仅内存模式精确生效；流式模式由全局 limits 截断（413）兜底 */
  maxSize?: number;
  /** 允许的 MIME 类型白名单（比对时统一小写，大小写不敏感） */
  allowedMime?: readonly string[];
  /** 允许的扩展名白名单（含点号，如 ['.png', '.jpg']） */
  allowedExt?: readonly string[];
  /**
   * 流式直存模式 — 拦截器把流边收边写入 PATHS.STORAGE_TMP/<uuid>，载荷携带 tmpPath，
   * 由 MediaService 流式搬到最终路径，避免大文件 OOM。代价：size 未知，
   * maxSize 依赖全局 limits 截断（413）兜底。
   */
  streamToDisk?: boolean;
}

/** Reflector metadata key — 由 @UploadedFile / @UploadedFiles 写入，MultipartInterceptor 读取 */
export const UPLOAD_OPTIONS_KEY = 'upload_options';

/** request 上挂载已收集文件的字段名，供参数装饰器取用 */
export const UPLOADED_FILES_KEY = '__uploadedFiles';

/**
 * MultipartInterceptor 单元测试
 *
 * 覆盖：非上传路由放行、内存模式收集、流式模式边收边写 tmp（P0 挂起回归）、
 *      校验边界（maxSize:0 / mime 大小写）、失败路径 tmp 清理
 *
 * node:fs 被 mock：createWriteStream 返回 PassThrough 不真实落盘，
 * promises.mkdir/unlink 用 vi.fn 断言调用，避免污染真实文件系统。
 */
import { PassThrough, Readable } from 'node:stream';
import { BadRequestException, type CallHandler, type ExecutionContext, PayloadTooLargeException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { firstValueFrom, type Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MultipartInterceptor } from '@/common/interceptors/multipart.interceptor';
import {
  UPLOAD_OPTIONS_KEY,
  UPLOADED_FILES_KEY,
  type UploadedFile,
  type UploadOptions,
} from '@/common/storage/interfaces/upload.interface';

const fsMock = vi.hoisted(() => ({
  createWriteStream: vi.fn(),
  promises: { mkdir: vi.fn(), unlink: vi.fn() },
}));

vi.mock('node:fs', () => ({
  createWriteStream: fsMock.createWriteStream,
  promises: fsMock.promises,
}));

interface FilePart {
  fieldname: string;
  filename: string;
  mimetype: string;
  content: Buffer;
  truncated?: boolean;
}

/** 构造 async generator 模拟 req.files()，并保留源流引用以断言「已消费」 */
function makeParts(parts: FilePart[]): { generator: AsyncGenerator<object>; streams: Readable[] } {
  const streams: Readable[] = [];
  const generator = (async function* () {
    for (const part of parts) {
      const stream = Readable.from([part.content]);
      if (part.truncated) Object.assign(stream, { truncated: true });
      streams.push(stream);
      yield { type: 'file', fieldname: part.fieldname, filename: part.filename, mimetype: part.mimetype, file: stream };
    }
  })();
  return { generator, streams };
}

describe('MultipartInterceptor', () => {
  let interceptor: MultipartInterceptor;

  beforeEach(async () => {
    fsMock.createWriteStream.mockReset().mockImplementation(() => new PassThrough());
    fsMock.promises.mkdir.mockReset().mockResolvedValue(undefined);
    fsMock.promises.unlink.mockReset().mockResolvedValue(undefined);

    const module = await Test.createTestingModule({ providers: [MultipartInterceptor, Reflector] }).compile();
    interceptor = module.get(MultipartInterceptor);
  });

  /** 组装 metadata + request + handler，执行拦截器并返回 observable / req / 源流 */
  async function run(
    options: UploadOptions | undefined,
    parts: FilePart[],
  ): Promise<{ observable: Observable<unknown>; req: Record<string, unknown>; streams: Readable[] }> {
    const handler = { name: 'upload' };
    Reflect.defineMetadata(UPLOAD_OPTIONS_KEY, options, handler);
    const { generator, streams } = makeParts(parts);
    const req: Record<string, unknown> = { files: () => generator, tmpUploads: undefined };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of({ ok: true }) };
    const observable = await interceptor.intercept(ctx, next);
    return { observable, req, streams };
  }

  it('未装饰的路由直接放行', async () => {
    const handler = { name: 'plain' };
    const req: Record<string, unknown> = { files: () => makeParts([]).generator, tmpUploads: undefined };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: vi.fn(() => of('ok')) };

    const observable = await interceptor.intercept(ctx, next);

    expect(next.handle).toHaveBeenCalledTimes(1);
    await expect(firstValueFrom(observable)).resolves.toBe('ok');
  });

  it('内存模式（默认）收集 buffer 与精确 size', async () => {
    const { observable, req } = await run({}, [
      { fieldname: 'file', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('abc') },
    ]);
    const files = Reflect.get(req, UPLOADED_FILES_KEY) as UploadedFile[];

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      type: 'memory',
      fieldname: 'file',
      filename: 'a.png',
      mimetype: 'image/png',
      size: 3,
    });
    expect((files[0] as Extract<UploadedFile, { type: 'memory' }>).buffer.equals(Buffer.from('abc'))).toBe(true);
    await firstValueFrom(observable);
  });

  it('内存模式截断流抛 413', async () => {
    await expect(
      run({}, [
        {
          fieldname: 'file',
          filename: 'big.bin',
          mimetype: 'application/octet-stream',
          content: Buffer.from('x'),
          truncated: true,
        },
      ]),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('流式模式：循环内立即消费流写盘，载荷携带 tmpPath（P0 回归）', async () => {
    const { observable, req, streams } = await run({ streamToDisk: true }, [
      { fieldname: 'file', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('abc') },
    ]);
    const files = Reflect.get(req, UPLOADED_FILES_KEY) as UploadedFile[];
    const file = files[0] as Extract<UploadedFile, { type: 'stream' }>;

    expect(files).toHaveLength(1);
    expect(file).toMatchObject({ type: 'stream', fieldname: 'file', filename: 'a.png', mimetype: 'image/png' });
    expect(file.tmpPath).toMatch(/^storage[\\/]tmp[\\/][0-9a-f-]{36}$/);
    // P0 回归：收集完成后源流必须已被完全消费，busboy 才不会被阻塞
    expect(streams[0].readableEnded).toBe(true);
    // fastify-multipart onResponse 兜底：tmp 路径挂入 request.tmpUploads
    expect(req.tmpUploads).toEqual([{ filepath: file.tmpPath }]);
    await firstValueFrom(observable);
  });

  it('流式模式截断仅标记，不立即抛错（由写盘方判定）', async () => {
    const { observable, req } = await run({ streamToDisk: true }, [
      {
        fieldname: 'file',
        filename: 'big.bin',
        mimetype: 'application/octet-stream',
        content: Buffer.from('x'),
        truncated: true,
      },
    ]);
    const files = Reflect.get(req, UPLOADED_FILES_KEY) as UploadedFile[];

    expect((files[0] as Extract<UploadedFile, { type: 'stream' }>).truncated).toBe(true);
    await firstValueFrom(observable);
  });

  it('流式模式写盘中失败（超限截断）→ 清理部分 tmp 文件并重抛', async () => {
    // 模拟全局 fileSize 截断：pipeline 接管后源流被销毁 → 拒绝
    fsMock.createWriteStream.mockImplementationOnce(() => {
      const stream = new PassThrough();
      queueMicrotask(() => stream.destroy(new Error('FST_REQ_FILE_TOO_LARGE')));
      return stream;
    });

    await expect(
      run({ streamToDisk: true }, [
        { fieldname: 'file', filename: 'big.bin', mimetype: 'application/octet-stream', content: Buffer.from('abc') },
      ]),
    ).rejects.toThrow('FST_REQ_FILE_TOO_LARGE');

    // 部分写入的 tmp 必须被 #streamToTmp 失败路径删除，不得孤儿残留
    expect(fsMock.promises.unlink).toHaveBeenCalledTimes(1);
    expect(fsMock.promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/^storage[\\/]tmp[\\/]/));
  });

  it('流式模式多文件按顺序收集', async () => {
    const { observable, req } = await run({ streamToDisk: true }, [
      { fieldname: 'a', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('a') },
      { fieldname: 'b', filename: 'b.png', mimetype: 'image/png', content: Buffer.from('b') },
    ]);
    const files = Reflect.get(req, UPLOADED_FILES_KEY) as UploadedFile[];

    expect(files.map((f) => f.fieldname)).toEqual(['a', 'b']);
    await firstValueFrom(observable);
  });

  it('handler 完成后清理未被消费的 tmp 文件', async () => {
    const { observable } = await run({ streamToDisk: true }, [
      { fieldname: 'file', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('abc') },
    ]);
    await firstValueFrom(observable);

    await vi.waitFor(() => expect(fsMock.promises.unlink).toHaveBeenCalledTimes(1));
    expect(fsMock.promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/^storage[\\/]tmp[\\/]/));
  });

  it('校验失败时清理已写 tmp 文件', async () => {
    await expect(
      run({ streamToDisk: true, allowedMime: ['image/png'] }, [
        { fieldname: 'file', filename: 'a.exe', mimetype: 'application/x-msdownload', content: Buffer.from('abc') },
      ]),
    ).rejects.toThrow(BadRequestException);

    await vi.waitFor(() => expect(fsMock.promises.unlink).toHaveBeenCalledTimes(1));
  });

  it('maxSize: 0 不被吞掉（=== undefined 判断）', async () => {
    await expect(
      run({ maxSize: 0 }, [
        { fieldname: 'file', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('abc') },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('mime 白名单比对大小写不敏感', async () => {
    const { observable, req } = await run({ allowedMime: ['image/png'] }, [
      { fieldname: 'file', filename: 'a.png', mimetype: 'Image/PNG', content: Buffer.from('abc') },
    ]);

    expect(Reflect.get(req, UPLOADED_FILES_KEY)).toHaveLength(1);
    await firstValueFrom(observable);
  });

  it('allowedExt 校验失败抛 BadRequestException', async () => {
    await expect(
      run({ allowedExt: ['.png'] }, [
        { fieldname: 'file', filename: 'a.exe', mimetype: 'application/x-msdownload', content: Buffer.from('abc') },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('maxSize 内文件正常通过', async () => {
    const { observable, req } = await run({ maxSize: 1024 }, [
      { fieldname: 'file', filename: 'a.png', mimetype: 'image/png', content: Buffer.from('abc') },
    ]);

    expect(Reflect.get(req, UPLOADED_FILES_KEY)).toHaveLength(1);
    await firstValueFrom(observable);
  });
});

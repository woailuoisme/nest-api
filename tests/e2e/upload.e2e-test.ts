/**
 * 上传链路 E2E — 平台原生 multipart 拦截器（`@nestjs/platform-fastify/multipart`）。
 *
 * 覆盖：内存模式收集与精确 size、流式载荷完整消费（无中间临时文件、不挂起）、
 *      落盘与最终 URL、超出 limits.fileSize 的 413（内存与流式两路）、fileFilter 白名单 400。
 *
 * 隔离：最终文件落 storage/tmp/e2e-uploads（git 忽略），afterAll 统一清理并断言无残留。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import fastifyMultipart from '@fastify/multipart';
import {
  Controller,
  Post,
  UploadedFile as UploadedFileDecorator,
  UploadedFiles as UploadedFilesDecorator,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { FileInterceptor, FileStreamInterceptor, FilesInterceptor } from '@nestjs/platform-fastify/multipart';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/common/constants/app.constants';
import { MediaModule } from '@/common/media/media.module';
import { MediaService } from '@/common/media/media.service';
import {
  createUploadFileFilter,
  isStreamUpload,
  type UploadedFile,
} from '@/common/storage/interfaces/upload.interface';
import { StorageModule } from '@/common/storage/storage.module';

/** E2E 专用上传控制器 — 各路由分别覆盖一种原生拦截器/载荷形态 */
@Controller('test-upload')
class UploadTestController {
  constructor(private readonly mediaService: MediaService) {}

  /** 内存模式：单文件收集（默认 memoryStorage） */
  @Post('memory')
  @UseInterceptors(FileInterceptor('file'))
  uploadMemory(@UploadedFileDecorator() file?: UploadedFile) {
    if (!file || isStreamUpload(file)) return { ok: false };
    return { ok: true, filename: file.originalname, size: file.size };
  }

  /** 流式模式：完整消费流并统计字节数（不消费会触发 busboy 回压导致请求挂起，P0 回归点） */
  @Post('stream')
  @UseInterceptors(FileStreamInterceptor('file'))
  async uploadStream(@UploadedFileDecorator() file?: UploadedFile) {
    if (!file || !isStreamUpload(file)) return { ok: false };
    let bytes = 0;
    for await (const chunk of file.stream) {
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string);
    }
    return { ok: true, filename: file.originalname, bytes };
  }

  /** 流式模式 + save 落盘 */
  @Post('stream-save')
  @UseInterceptors(FileStreamInterceptor('file'))
  async uploadStreamSave(@UploadedFileDecorator() file: UploadedFile) {
    const { url } = await this.mediaService.save(file, { prefix: 'e2e' });
    return { ok: true, url };
  }

  /** 多文件收集（同字段名多文件） */
  @Post('multiple')
  @UseInterceptors(FilesInterceptor('file', 5))
  uploadMultiple(@UploadedFilesDecorator() files: UploadedFile[] = []) {
    return { ok: true, count: files.length, filenames: files.map((f) => f.originalname) };
  }

  /** 内存模式 + fileFilter 白名单校验 */
  @Post('validated')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: createUploadFileFilter({ allowedMime: ['image/png'], allowedExt: ['.png'] }),
    }),
  )
  uploadValidated(@UploadedFileDecorator() _file?: UploadedFile) {
    return { ok: true };
  }
}

/** 构造 multipart/form-data body（Buffer 拼接保证二进制无损） */
function buildMultipart(
  files: { name: string; filename: string; mimetype: string; content: Buffer }[],
  boundary: string,
): Buffer {
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${f.mimetype}\r\n\r\n`));
    chunks.push(f.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/** 读取 storage/tmp 下的残留文件（目录不存在视为空；隔离上传根 e2e-uploads 不算残留） */
async function listTmpFiles(): Promise<string[]> {
  try {
    return (await fs.readdir(join(process.cwd(), PATHS.STORAGE_TMP))).filter((name) => name !== 'e2e-uploads');
  } catch {
    return [];
  }
}

/** 递归收集目录下的文件（空目录不计入 —— 流式写入失败可能留下空目录树，属可接受状态） */
async function listFilesRecursively(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        return entry.isDirectory() ? listFilesRecursively(full) : [full];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

/** E2E 隔离存储根目录（与测试临时文件一并清理） */
const uploadRoot = join(process.cwd(), PATHS.STORAGE_TMP, 'e2e-uploads');

describe('上传链路 (e2e)', () => {
  let app: NestFastifyApplication;
  const boundary = '----E2EBoundary';

  const filePart = (filename: string, mimetype: string, content: Buffer) => ({
    name: 'file',
    filename,
    mimetype,
    content,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        StorageModule,
        MediaModule,
        // 配置隔离：local 驱动 + 独立上传根目录，不读 .env
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: uploadRoot, MEDIA_QUEUE_ENABLED: false })],
        }),
      ],
      controllers: [UploadTestController],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // 全局 multipart 插件：fileSize=2048B，原生拦截器未显式声明 limits 时回落到此（与生产一致）
    await app.register(fastifyMultipart as unknown as Parameters<typeof app.register>[0], {
      limits: { fileSize: 2048 },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await fs.rm(uploadRoot, { recursive: true, force: true });
    await fs.rm(join(process.cwd(), PATHS.STORAGE_TMP), { recursive: true, force: true });
  });

  afterAll(async () => {
    await app?.close();
    await fs.rm(uploadRoot, { recursive: true, force: true });
    await fs.rm(join(process.cwd(), PATHS.STORAGE_TMP), { recursive: true, force: true });
  });

  /** 统一发起 multipart 请求 */
  function post(url: string, payload: Buffer) {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }

  /** 构造单文件 multipart 请求（Buffer 拼接保证二进制无损） */
  function postFile(url: string, filename: string, mimetype: string, content: Buffer) {
    return post(url, buildMultipart([filePart(filename, mimetype, content)], boundary));
  }

  it('流式载荷完整消费且请求不挂起（P0 回归）', async () => {
    const content = Buffer.from('hello e2e');
    const response = await postFile('/test-upload/stream', 'a.png', 'image/png', content);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toMatchObject({ ok: true, filename: 'a.png', bytes: content.length });
  });

  it('多文件顺序收集', async () => {
    const payload = buildMultipart(
      [filePart('a.png', 'image/png', Buffer.from('aaa')), filePart('b.txt', 'text/plain', Buffer.from('bbb'))],
      boundary,
    );
    const response = await post('/test-upload/multiple', payload);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toMatchObject({ ok: true, count: 2, filenames: ['a.png', 'b.txt'] });
  });

  it('内存模式收集 buffer 与精确 size', async () => {
    const content = Buffer.from('hello e2e');
    const response = await postFile('/test-upload/memory', 'a.png', 'image/png', content);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toMatchObject({ ok: true, filename: 'a.png', size: content.length });
  });

  it('流式 save 落盘到最终路径并返回 URL，且不产生中间临时文件', async () => {
    const content = Buffer.from('final content');
    const response = await postFile('/test-upload/stream-save', 'a.png', 'image/png', content);

    expect(response.statusCode).toBe(201);
    const { url } = JSON.parse(response.payload) as { url: string };
    expect(url).toMatch(/^\/uploads\/e2e\/\d{8}\/[0-9a-f-]{36}\.png$/);

    const stored = await fs.readFile(join(uploadRoot, url.replace('/uploads/', '')));
    expect(stored.equals(content)).toBe(true);
    expect(await listTmpFiles()).toHaveLength(0);
  });

  it('流式载荷超过 fileSize 上限 → 413 且无孤儿文件', async () => {
    const response = await postFile(
      '/test-upload/stream-save',
      'big.bin',
      'application/octet-stream',
      Buffer.alloc(4096, 1),
    );

    expect(response.statusCode).toBe(413);
    // 失败路径不残留任何（含部分写入的）最终文件
    expect(await listFilesRecursively(uploadRoot)).toHaveLength(0);
    await vi.waitFor(async () => {
      expect(await listTmpFiles()).toHaveLength(0);
    });
  });

  it('内存模式超限 → 413', async () => {
    const response = await postFile(
      '/test-upload/memory',
      'big.bin',
      'application/octet-stream',
      Buffer.alloc(4096, 1),
    );

    expect(response.statusCode).toBe(413);
  });

  it('mime / 扩展名不在白名单 → 400', async () => {
    const response = await postFile('/test-upload/validated', 'a.exe', 'application/x-msdownload', Buffer.from('x'));

    expect(response.statusCode).toBe(400);
  });

  it('请求结束后 storage/tmp 无残留文件', async () => {
    await postFile('/test-upload/stream', 'a.png', 'image/png', Buffer.from('x'));

    await vi.waitFor(async () => {
      expect(await listTmpFiles()).toHaveLength(0);
    });
  });
});

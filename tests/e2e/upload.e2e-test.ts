/**
 * 上传链路 E2E 测试 — 真实 @fastify/multipart + 真实 multipart body。
 *
 * 覆盖：单/多文件 streamToDisk 不挂起（P0 回归）、内存模式收集、
 *      流式 save 落盘与 tmp 清理、超限 413、mime 校验 400。
 *
 * 隔离：最终文件落 storage/tmp/e2e-uploads，拦截器 tmp 落 storage/tmp（git 忽略），afterAll 统一清理。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import { Controller, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/common/constants/app.constants';
import { UploadedFile, UploadedFiles } from '@/common/decorators/uploaded.decorator';
import { MultipartInterceptor } from '@/common/interceptors/multipart.interceptor';
import { MediaModule } from '@/common/media/media.module';
import { MediaService } from '@/common/media/media.service';
import type { UploadedFile as UploadedFilePayload } from '@/common/storage/interfaces/upload.interface';
import { StorageModule } from '@/common/storage/storage.module';

/** E2E 专用上传控制器 — 各路由分别覆盖一种载荷形态 */
@Controller('test-upload')
class UploadTestController {
  constructor(private readonly mediaService: MediaService) {}

  /** 内存模式：单文件收集 */
  @Post('memory')
  uploadMemory(@UploadedFile() file: UploadedFilePayload | undefined) {
    if (file?.type !== 'memory') return { ok: false };
    return { ok: true, filename: file.filename, size: file.size };
  }

  /** 流式模式：仅收集不消费 — 若流未被消费，handler 永不执行，请求即挂起（P0 回归点） */
  @Post('stream')
  uploadStream(@UploadedFile({ streamToDisk: true }) file: UploadedFilePayload | undefined) {
    if (file?.type !== 'stream') return { ok: false };
    return { ok: true, filename: file.filename, tmpPath: file.tmpPath };
  }

  /** 流式模式 + save 落盘（写盘后判定截断 → 413） */
  @Post('stream-save')
  async uploadStreamSave(@UploadedFile({ streamToDisk: true }) file: UploadedFilePayload) {
    const { url } = await this.mediaService.save(file, { prefix: 'e2e' });
    return { ok: true, url };
  }

  /** 流式模式：多文件收集 */
  @Post('multiple')
  uploadMultiple(@UploadedFiles({ streamToDisk: true }) files: UploadedFilePayload[]) {
    return { ok: true, count: files.length, filenames: files.map((f) => f.filename) };
  }

  /** 内存模式 + mime 白名单校验 */
  @Post('validated')
  uploadValidated(@UploadedFile({ allowedMime: ['image/png'] }) _file: UploadedFilePayload) {
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
      providers: [{ provide: APP_INTERCEPTOR, useClass: MultipartInterceptor }],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // 显式注册 multipart 插件：fileSize=2048B，正常文件通过、超大文件触发截断
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

  it('单文件 streamToDisk 请求不挂起并返回 tmpPath（P0 回归）', async () => {
    const payload = buildMultipart([filePart('a.png', 'image/png', Buffer.from('hello e2e'))], boundary);
    const response = await post('/test-upload/stream', payload);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.ok).toBe(true);
    expect(body.filename).toBe('a.png');
    expect(body.tmpPath).toMatch(/^storage[\\/]tmp[\\/][0-9a-f-]{36}$/);
  });

  it('多文件 streamToDisk 顺序收集', async () => {
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
    const payload = buildMultipart([filePart('a.png', 'image/png', content)], boundary);
    const response = await post('/test-upload/memory', payload);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toMatchObject({ ok: true, filename: 'a.png', size: content.length });
  });

  it('流式 save 落盘到最终路径并返回 URL，tmp 消费即删', async () => {
    const content = Buffer.from('final content');
    const payload = buildMultipart([filePart('a.png', 'image/png', content)], boundary);
    const response = await post('/test-upload/stream-save', payload);

    expect(response.statusCode).toBe(201);
    const { url } = JSON.parse(response.payload) as { url: string };
    expect(url).toMatch(/^\/uploads\/e2e\/\d{8}\/[0-9a-f-]{36}\.png$/);

    const stored = await fs.readFile(join(uploadRoot, url.replace('/uploads/', '')));
    expect(stored.equals(content)).toBe(true);
    expect(await listTmpFiles()).toHaveLength(0);
  });

  it('超过 fileSize 上限 → 写盘后判定截断抛 413，失败路径无孤儿残留', async () => {
    const payload = buildMultipart([filePart('big.bin', 'application/octet-stream', Buffer.alloc(4096, 1))], boundary);
    const response = await post('/test-upload/stream-save', payload);

    expect(response.statusCode).toBe(413);
    // 失败路径不残留最终文件
    expect(await fs.readdir(uploadRoot).catch(() => [])).toHaveLength(0);
    // P0 修复回归：超限触发 pipeline 拒绝时，部分写入的 tmp 文件必须被清理
    await vi.waitFor(async () => {
      expect(await listTmpFiles()).toHaveLength(0);
    });
  });

  it('内存模式超限 → 拦截器直接抛 413', async () => {
    const payload = buildMultipart([filePart('big.bin', 'application/octet-stream', Buffer.alloc(4096, 1))], boundary);
    const response = await post('/test-upload/memory', payload);

    expect(response.statusCode).toBe(413);
  });

  it('mime 不在白名单 → 400', async () => {
    const payload = buildMultipart([filePart('a.exe', 'application/x-msdownload', Buffer.from('x'))], boundary);
    const response = await post('/test-upload/validated', payload);

    expect(response.statusCode).toBe(400);
  });

  it('请求结束后 storage/tmp 无残留文件（finalize / onResponse 兜底）', async () => {
    const payload = buildMultipart([filePart('a.png', 'image/png', Buffer.from('x'))], boundary);
    await post('/test-upload/stream', payload);

    await vi.waitFor(async () => {
      expect(await listTmpFiles()).toHaveLength(0);
    });
  });
});

/**
 * 响应压缩契约 E2E — 装配完整 AppModule 并套用生产 Fastify 插件链（`registerFastifyPlugins`）与 Nest 中间件链。
 *
 * 覆盖 `@fastify/compress` 的对外可观察行为：
 * 1. 文本类大响应按 `Accept-Encoding` 协商压缩（br / gzip）并附 `Vary: accept-encoding`；
 * 2. 未声明 `Accept-Encoding` 时原样透出；
 * 3. 低于体积阈值的响应不压缩（避免小响应上的 CPU 负收益）；
 * 4. 已压缩二进制（webp）不参与压缩 —— 与同体积文本对照，排除「因体积小而未压缩」的误判；
 * 5. `x-no-compression` 请求头为插件内置逃生阀。
 *
 * SSE（`text/event-stream`）未纳入用例：项目当前无 SSE 生产者（实时推送走 Centrifugo WebSocket），
 * 且插件默认可压缩类型正则已显式排除 event-stream（`^text\/(?!event-stream)|…`），SSE 不存在被压缩的代码路径。
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '@/app.module';
import { PATHS } from '@/common/constants/app.constants';
import { setupGlobalMiddleware } from '@/setup/middleware';
import { registerFastifyPlugins } from '@/setup/plugins';
import { setupApiDocumentation } from '@/setup/swagger';

const PUBLIC_DIR = join(process.cwd(), PATHS.STORAGE_UPLOADS, 'public');
const TEXT_FILE = 'compression-probe.txt';
const BINARY_FILE = 'compression-probe.webp';
/** 可压缩探针载荷（5376 字节 > 默认阈值 1024，确保走压缩路径而非阈值豁免） */
const TEXT_PAYLOAD = 'compressible-payload '.repeat(256);
const PROBE_BYTES = Buffer.byteLength(TEXT_PAYLOAD);

describe('响应压缩 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await mkdir(PUBLIC_DIR, { recursive: true });
    // 文本可压缩 / webp 已压缩，两者体积相同 → 体积不是差异的解释变量
    await writeFile(join(PUBLIC_DIR, TEXT_FILE), 'compressible-payload '.repeat(PROBE_BYTES / 21));
    await writeFile(join(PUBLIC_DIR, BINARY_FILE), randomBytes(PROBE_BYTES));

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await registerFastifyPlugins(app);
    setupGlobalMiddleware(app);
    await setupApiDocumentation(app, 'http://localhost:4300');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await rm(join(PUBLIC_DIR, TEXT_FILE), { force: true });
    await rm(join(PUBLIC_DIR, BINARY_FILE), { force: true });
    // 尽力清理本次创建的目录（已存在时 rmdir 失败，忽略即可）
    await rmdir(PUBLIC_DIR).catch(() => undefined);
    await app?.close();
  });

  /** 以指定头请求静态探针文件 */
  function probePublicFile(fileName: string, headers: Record<string, string>) {
    return app.inject({ method: 'GET', url: `/uploads/public/${fileName}`, headers });
  }

  it('大体积文本响应：Accept-Encoding: br 时压缩并附 Vary: accept-encoding', async () => {
    const response = await probePublicFile(TEXT_FILE, { 'accept-encoding': 'br' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(String(response.headers.vary)).toContain('accept-encoding');
  });

  it('协商回落：Accept-Encoding: gzip 时使用 gzip', async () => {
    const response = await probePublicFile(TEXT_FILE, { 'accept-encoding': 'gzip' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('未声明 Accept-Encoding 时原样透出（不压缩）', async () => {
    const response = await probePublicFile(TEXT_FILE, {});

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.payload).toBe(TEXT_PAYLOAD);
  });

  it('同体积已压缩二进制（webp）不参与压缩', async () => {
    const response = await probePublicFile(BINARY_FILE, { 'accept-encoding': 'br' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('x-no-compression 逃生阀生效', async () => {
    const response = await probePublicFile(TEXT_FILE, { 'accept-encoding': 'br', 'x-no-compression': '1' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('低于阈值的响应不压缩（401 错误信封虽为 application/json 亦不压缩）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { 'accept-encoding': 'br' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('大体积 JSON 文档响应压缩（/docs-json）', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs-json', headers: { 'accept-encoding': 'br' } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
  });
});

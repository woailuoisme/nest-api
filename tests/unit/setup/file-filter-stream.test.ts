import { Writable } from 'node:stream';
import { delay } from 'es-toolkit';
import { describe, expect, it } from 'vitest';
import { createFileFilterStream } from '@/setup/logger';

describe('createFileFilterStream', () => {
  it('应正确过滤健康的 2xx/3xx HTTP 访问日志，保留 4xx/5xx 异常与业务日志', async () => {
    const writtenChunks: string[] = [];
    const mockDestination = new Writable({
      write(chunk, _encoding, callback) {
        writtenChunks.push(chunk.toString());
        callback();
      },
    });

    const filterStream = createFileFilterStream(mockDestination);

    // 1. 模拟健康 200 HTTP 访问日志（应被过滤）
    const http200Log = {
      level: 30,
      method: 'GET',
      url: '/api/v1/users',
      statusCode: 200,
      duration: 15.5,
      ip: '127.0.0.1',
      msg: 'GET /api/v1/users 200 (15.5ms) - 127.0.0.1',
    };

    // 2. 模拟旧格式 HTTP 访问日志（应被过滤）
    const legacyHttpLog = {
      level: 30,
      req: { id: 'req-1', method: 'GET', url: '/v1/test' },
      res: { statusCode: 200 },
      responseTime: 10,
      msg: 'GET /v1/test -> 200 (10ms)',
    };

    // 3. 模拟 404 客户端异常日志（应保留并落盘）
    const http404Log = {
      level: 40,
      method: 'GET',
      url: '/not-found',
      statusCode: 404,
      duration: 5.2,
      ip: '127.0.0.1',
      msg: 'GET /not-found 404 (5.2ms) - 127.0.0.1',
    };

    // 4. 模拟 500 服务端异常日志（应保留并落盘）
    const http500Log = {
      level: 50,
      method: 'POST',
      url: '/api/v1/orders',
      statusCode: 500,
      duration: 102.1,
      ip: '127.0.0.1',
      msg: 'POST /api/v1/orders 500 (102.1ms) - 127.0.0.1',
    };

    // 5. 模拟普通应用层业务日志（应保留并落盘）
    const appInfoLog = {
      level: 30,
      context: 'UsersService',
      msg: 'User created successfully',
    };

    // 6. 模拟非 JSON 原始字符串（应直接放行）
    const rawString = 'Plain text bootstrap notification\n';

    filterStream.write(`${JSON.stringify(http200Log)}\n`);
    filterStream.write(`${JSON.stringify(legacyHttpLog)}\n`);
    filterStream.write(`${JSON.stringify(http404Log)}\n`);
    filterStream.write(`${JSON.stringify(http500Log)}\n`);
    filterStream.write(`${JSON.stringify(appInfoLog)}\n`);
    filterStream.write(rawString);
    filterStream.end();

    // 等待 stream 处理
    await delay(50);

    expect(writtenChunks).toHaveLength(4);
    expect(writtenChunks.some((c) => c.includes('GET /api/v1/users 200'))).toBe(false);
    expect(writtenChunks.some((c) => c.includes('GET /v1/test -> 200'))).toBe(false);
    expect(writtenChunks.some((c) => c.includes('GET /not-found 404'))).toBe(true);
    expect(writtenChunks.some((c) => c.includes('POST /api/v1/orders 500'))).toBe(true);
    expect(writtenChunks.some((c) => c.includes('User created successfully'))).toBe(true);
    expect(writtenChunks.some((c) => c.includes('Plain text bootstrap notification'))).toBe(true);
  });
});

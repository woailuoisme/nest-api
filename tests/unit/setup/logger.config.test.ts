import { existsSync, readdirSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPinoLogger, createRequestId, extractIp, REDACT_PATHS, redactUrl } from '@/setup/logger';

/**
 * pino 把落点流与基字段挂在内部 symbol 上，官方 d.ts 未暴露索引签名，故测试内做最小透传访问。
 */
const getStreamFd = (logger: pino.Logger): number | undefined =>
  (logger as unknown as Record<symbol, { fd?: number }>)[pino.symbols.streamSym]?.fd;

const getChindings = (logger: pino.Logger): string =>
  String((logger as unknown as Record<symbol, unknown>)[pino.symbols.chindingsSym]);

describe('logger.config', () => {
  // 兜底：任一用例断言失败时也不会把 stub 的 APP_ENV 泄漏给同文件后续用例
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('redactUrl', () => {
    it('脱敏 token query，防止 JWT 落入访问日志', () => {
      const url = '/uploads/avatar.png?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret';
      expect(redactUrl(url)).toBe('/uploads/avatar.png?token=[redacted]');
    });

    it('access_token / refresh_token 一并脱敏', () => {
      const url = '/a?access_token=x&refresh_token=y&keep=1';
      expect(redactUrl(url)).toBe('/a?access_token=[redacted]&refresh_token=[redacted]&keep=1');
    });

    it('无 url 或空字符串时返回占位符', () => {
      expect(redactUrl()).toBe('-');
      expect(redactUrl('')).toBe('-');
    });
  });

  describe('createRequestId', () => {
    it('优先使用请求头中的 x-request-id', () => {
      const id = createRequestId({
        headers: { 'x-request-id': 'client-req-999' },
      });
      expect(id).toBe('client-req-999');
    });

    it('无 x-request-id 时复用现有 req.id', () => {
      const id = createRequestId({
        headers: {},
        id: 'existing-id-123',
      });
      expect(id).toBe('existing-id-123');
    });

    it('无任何 ID 时生成有效 UUID', () => {
      const id = createRequestId({ headers: {} });
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('extractIp', () => {
    it('优先从 x-forwarded-for 获取客户端真实 IP', () => {
      const mockReq = {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
        socket: { remoteAddress: '10.0.0.1' },
      } as unknown as IncomingMessage;

      expect(extractIp(mockReq)).toBe('203.0.113.195, 70.41.3.18');
    });

    it('无 x-forwarded-for 时回退至 socket remoteAddress', () => {
      const mockReq = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      expect(extractIp(mockReq)).toBe('127.0.0.1');
    });
  });

  describe('REDACT_PATHS', () => {
    it('配置了敏感字段全局脱敏规则', () => {
      expect(REDACT_PATHS).toContain('password');
      expect(REDACT_PATHS).toContain('passwordHash');
      expect(REDACT_PATHS).toContain('token');
      expect(REDACT_PATHS).toContain('refreshToken');
      expect(REDACT_PATHS).toContain('req.headers.authorization');
    });
  });

  describe('createPinoLogger', () => {
    it('支持传入 customDestination 并正确输出日志', async () => {
      const logs: string[] = [];
      const customStream = new Writable({
        write(chunk, _encoding, callback) {
          logs.push(chunk.toString());
          callback();
        },
      });

      const logger = await createPinoLogger(customStream);
      logger.info({ context: 'TestContext' }, 'test message');

      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.msg).toBe('test message');
      expect(parsed.context).toBe('TestContext');
    });

    it('默认配置（开发/测试）创建 logger 使用 pretty 格式化', async () => {
      const logger = await createPinoLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('非生产环境默认 level=debug（保留既有调试可见性），LOG_LEVEL 可显式覆盖', async () => {
      expect((await createPinoLogger()).level).toBe('debug');

      vi.stubEnv('LOG_LEVEL', 'warn');
      expect((await createPinoLogger()).level).toBe('warn');
      vi.unstubAllEnvs();
    });

    it('生产环境：level 收敛为 info 且不再落盘（日志只走 stdout）', async () => {
      vi.stubEnv('APP_ENV', 'production');
      const logsDir = join(process.cwd(), 'storage', 'logs');
      const before = existsSync(logsDir) ? readdirSync(logsDir) : [];

      const logger = await createPinoLogger();
      logger.error('production smoke');

      expect(logger.level).toBe('info');
      // 反向断言：文件日志已移除，写日志不应产生任何新的日志文件（与运行前快照一致）
      expect(existsSync(logsDir) ? readdirSync(logsDir) : []).toEqual(before);

      vi.unstubAllEnvs();
    });

    it('生产环境：输出落在 stdout JSON 通道，且带 service 基字段（守住形态不被改回 pretty）', async () => {
      vi.stubEnv('APP_ENV', 'production');

      const logger = await createPinoLogger();

      // 生产通道必须是直写 stdout 的流（fd 1）；pretty 通道是 Transform，无 fd → 改回 pretty 会在此失败
      expect(getStreamFd(logger)).toBe(1);
      // service 基字段用于区分 api / worker 进程（多进程 JSON 日志归集依赖它）
      expect(getChindings(logger)).toContain('"service"');

      vi.unstubAllEnvs();
    });

    it('开发/测试通道：仍由 pino-pretty 承载（非 JSON 流）', async () => {
      const logger = await createPinoLogger();

      expect(getStreamFd(logger)).toBeUndefined();
    });

    it('worker 入口应标记为 service=worker（守住 argv → service 的映射）', async () => {
      vi.stubEnv('APP_ENV', 'production');
      const originalEntry = process.argv[1];
      process.argv[1] = '/app/dist/workers/worker.main.js';

      try {
        const logger = await createPinoLogger();

        expect(getChindings(logger)).toContain('"service":"worker"');
      } finally {
        process.argv[1] = originalEntry;
      }
    });

    it('CLI 长驻进程按 verb 判定角色：cli worker → worker，cli serve → api', async () => {
      vi.stubEnv('APP_ENV', 'production');
      const originalEntry = process.argv[1];
      const originalVerb = process.argv[2];
      process.argv[1] = '/app/dist/cli.js';

      try {
        process.argv[2] = 'worker';
        expect(getChindings(await createPinoLogger())).toContain('"service":"worker"');

        process.argv[2] = 'serve';
        expect(getChindings(await createPinoLogger())).toContain('"service":"api"');
      } finally {
        process.argv[1] = originalEntry;
        if (originalVerb === undefined) {
          delete process.argv[2];
        } else {
          process.argv[2] = originalVerb;
        }
      }
    });

    it('生产启动不依赖 pino-pretty：模块缺失时仍能创建 logger（守住「不得静态导入 devDependency」）', async () => {
      vi.resetModules();
      // 模拟生产镜像（`bun install --production` 不含 devDeps）：只有静态导入才会在此炸掉
      vi.doMock('pino-pretty', () => {
        throw new Error("Cannot find module 'pino-pretty'");
      });
      vi.stubEnv('APP_ENV', 'production');

      const { createPinoLogger: createProductionLogger } = await import('@/setup/logger/logger.config');
      const logger = await createProductionLogger();

      expect(logger.level).toBe('info');

      vi.doUnmock('pino-pretty');
      vi.unstubAllEnvs();
      vi.resetModules();
    });
  });
});

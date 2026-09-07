import type { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPinoLogger, createRequestId, extractIp, REDACT_PATHS, redactUrl } from '@/setup/logger';

describe('logger.config', () => {
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

    it('默认配置创建 logger 包含 pretty 格式化', async () => {
      const logger = await createPinoLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });
  });
});

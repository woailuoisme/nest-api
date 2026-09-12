import type { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { trace } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { createPinoLogger, createRequestId, extractIp, REDACT_PATHS, redactUrl, traceMixin } from '@/setup/logger';

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

    it('无活跃 Span 时 traceMixin 返回空对象且日志不含 trace_id', async () => {
      const logs: string[] = [];
      const customStream = new Writable({
        write(chunk, _encoding, callback) {
          logs.push(chunk.toString());
          callback();
        },
      });

      const logger = await createPinoLogger(customStream);
      logger.info('standard log');

      const parsed = JSON.parse(logs[0]);
      expect(parsed.trace_id).toBeUndefined();
      expect(parsed.span_id).toBeUndefined();
    });
  });

  describe('traceMixin', () => {
    it('无 Span 上下文时返回空对象', () => {
      expect(traceMixin()).toEqual({});
    });

    it('SpanContext 无效（如 NoopSpan 全零 ID）时返回空对象', () => {
      const spy = vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
        spanContext: () => ({
          traceId: '00000000000000000000000000000000',
          spanId: '0000000000000000',
          traceFlags: 0,
        }),
      } as unknown as ReturnType<typeof trace.getActiveSpan>);

      try {
        expect(traceMixin()).toEqual({});
      } finally {
        spy.mockRestore();
      }
    });

    it('存在合法活跃 Span 时 traceMixin 正确提取 trace_id 与 span_id', () => {
      const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const validSpanId = '00f067aa0ba902b7';

      const spy = vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
        spanContext: () => ({
          traceId: validTraceId,
          spanId: validSpanId,
          traceFlags: 1,
        }),
      } as unknown as ReturnType<typeof trace.getActiveSpan>);

      try {
        expect(traceMixin()).toEqual({
          trace_id: validTraceId,
          span_id: validSpanId,
        });
      } finally {
        spy.mockRestore();
      }
    });
  });
});

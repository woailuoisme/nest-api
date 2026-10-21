import { Writable } from 'node:stream';

import { context, trace, type Span } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPinoLogger } from '@/setup/logger';

/** 最小 Span 桩：仅需 spanContext 供 mixin 读取 */
const fakeSpan = (traceId: string, spanId: string): Span =>
  ({
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
  }) as unknown as Span;

/** 内存 Writable：收集落盘的日志 JSON 行 */
const capture = (): { stream: Writable; lines: string[] } => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, lines };
};

describe('logger.config traceMixin (OTel 日志-链路关联)', () => {
  // 测试环境无 NodeSDK，需显式注册 context manager 才能使 context.with 传播活动 span
  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  });
  afterEach(() => {
    context.disable();
  });

  it('活动 span 存在时注入 trace_id / span_id / trace_flags', async () => {
    const { stream, lines } = capture();
    const logger = await createPinoLogger(stream);
    const span = fakeSpan('a'.repeat(32), 'b'.repeat(16));

    await context.with(trace.setSpan(context.active(), span), () => {
      logger.info('traced message');
    });

    const parsed = JSON.parse(lines[0]);
    expect(parsed.trace_id).toBe('a'.repeat(32));
    expect(parsed.span_id).toBe('b'.repeat(16));
    expect(parsed.trace_flags).toBe(1);
  });

  it('无活动 span 时不注入链路字段（零开销路径）', async () => {
    const { stream, lines } = capture();
    const logger = await createPinoLogger(stream);

    logger.info('plain message');

    const parsed = JSON.parse(lines[0]);
    expect(parsed.trace_id).toBeUndefined();
    expect(parsed.span_id).toBeUndefined();
  });

  it('键名契约守卫：下游 collector/O2 依赖 trace_id / span_id 精确键名', async () => {
    const { stream, lines } = capture();
    const logger = await createPinoLogger(stream);
    const span = fakeSpan('c'.repeat(32), 'd'.repeat(16));

    await context.with(trace.setSpan(context.active(), span), () => {
      logger.warn('key contract');
    });

    expect(Object.keys(JSON.parse(lines[0]))).toEqual(expect.arrayContaining(['trace_id', 'span_id', 'trace_flags']));
  });
});

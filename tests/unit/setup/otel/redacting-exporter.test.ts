import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';

import { createRedactingExporter } from '@/setup/otel/redacting-exporter';

/** 构造最小 ReadableSpan：脱敏只关心 attributes */
function spanOf(attributes: Record<string, unknown>): ReadableSpan {
  return { attributes } as unknown as ReadableSpan;
}

function innerExporter() {
  return {
    export: vi.fn((_spans: ReadableSpan[], cb: (result: { code: number }) => void) => cb({ code: 0 })),
    shutdown: vi.fn().mockResolvedValue(undefined),
    forceFlush: vi.fn().mockResolvedValue(undefined),
  } as unknown as SpanExporter & {
    export: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    forceFlush: ReturnType<typeof vi.fn>;
  };
}

describe('createRedactingExporter（出站 span 凭据脱敏）', () => {
  it('SMSBao 的 url.full 应丢弃 query（含 p=凭据摘要 与 c=验证码）', () => {
    const inner = innerExporter();
    const exporter = createRedactingExporter(inner);
    const span = spanOf({
      'url.full': 'https://api.smsbao.com/sms?u=acct&p=5f4dcc3b5aa765d61d8327deb882cf99&m=13800138000&c=123456',
      'http.request.method': 'GET',
    });

    exporter.export([span], () => {});

    expect(span.attributes['url.full']).toBe('https://api.smsbao.com/sms');
    expect(span.attributes['http.request.method']).toBe('GET');
    expect(inner.export).toHaveBeenCalledTimes(1);
  });

  it('旧语义约定 http.url 同样脱敏', () => {
    const inner = innerExporter();
    const exporter = createRedactingExporter(inner);
    const span = spanOf({ 'http.url': 'https://api.smsbao.com/sms?p=secret&c=654321' });

    exporter.export([span], () => {});

    expect(span.attributes['http.url']).toBe('https://api.smsbao.com/sms');
  });

  it('非敏感主机与其他网关 URL 保持原样（不误伤）', () => {
    const inner = innerExporter();
    const exporter = createRedactingExporter(inner);
    const urls = [
      'https://api.github.com/repos/x/y?page=2',
      'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential',
      'http://localhost:4300/users?token=abc',
    ];
    const spans = urls.map((url) => spanOf({ 'url.full': url }));

    exporter.export(spans, () => {});

    spans.forEach((span, index) => expect(span.attributes['url.full']).toBe(urls[index]));
  });

  it('畸形 URL 或缺失属性时安全跳过', () => {
    const inner = innerExporter();
    const exporter = createRedactingExporter(inner);
    const span = spanOf({ 'url.full': 'not-a-url', 'http.url': undefined });

    expect(() => exporter.export([span], () => {})).not.toThrow();
    expect(span.attributes['url.full']).toBe('not-a-url');
  });

  it('shutdown / forceFlush 透传给真实导出器', async () => {
    const inner = innerExporter();
    const exporter = createRedactingExporter(inner);

    await exporter.shutdown();
    await exporter.forceFlush?.();

    expect(inner.shutdown).toHaveBeenCalledTimes(1);
    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
  });
});

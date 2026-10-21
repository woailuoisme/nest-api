import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * 凭据以下发形式出现在 query 中的第三方网关主机。
 *
 * SMSBao 只提供 `GET /sms?u=&p=md5(password)&m=&c=`：`p` 是凭据等价物，`c` 是明文验证码。
 * 出站探针在请求发出时抓取完整 URL 写入 span，再随 OTLP 落到集中式可观测平台，
 * 业务层无法在发出前改写，因此只能在导出前统一抹掉 query。
 */
const CREDENTIAL_QUERY_HOSTS: ReadonlySet<string> = new Set(['api.smsbao.com']);

/** URL 属性名的语义约定新旧两代 */
const URL_ATTRIBUTE_KEYS = ['url.full', 'http.url'] as const;

/** 命中敏感主机时丢弃 query，仅保留 origin + path */
function stripCredentialQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (!CREDENTIAL_QUERY_HOSTS.has(url.hostname)) return value;
  return `${url.origin}${url.pathname}`;
}

/** 就地改写 span 的 URL 属性（SDK 未提供变更 API，导出阶段对象由本层掌握） */
function redactSpan(span: ReadableSpan): void {
  const attributes = span.attributes as unknown as Record<string, unknown>;

  for (const key of URL_ATTRIBUTE_KEYS) {
    const current = attributes[key];
    const redacted = stripCredentialQuery(current);
    if (redacted !== current) attributes[key] = redacted;
  }
}

/**
 * 出站 span 脱敏导出器：在交给真实导出器之前去掉敏感网关 URL 的 query。
 *
 * OTLP 导出器在 `export()` 内同步完成序列化，故调用前改写属性即可生效。
 */
export function createRedactingExporter(inner: SpanExporter): SpanExporter {
  return {
    export(spans, resultCallback) {
      for (const span of spans) redactSpan(span);
      inner.export(spans, resultCallback);
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

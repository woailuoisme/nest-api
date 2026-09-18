export interface ParsedMeilisearchConfig {
  host: string;
  apiKey?: string;
}

/**
 * 解析统一 Meilisearch DSN 格式
 *
 * 支持格式：
 * 1. meilisearch://masterKey@127.0.0.1:7700
 * 2. meilisearch://:masterKey@127.0.0.1:7700
 * 3. http://127.0.0.1:7700?apiKey=masterKey
 * 4. https://meili.example.com:7700/
 */
export function parseMeilisearchDsn(dsn: string): ParsedMeilisearchConfig {
  if (!dsn || typeof dsn !== 'string') {
    throw new Error('Invalid Meilisearch DSN: empty or non-string input');
  }

  // 若以 meilisearch:// 开头，转为 http(s) 进行标准 URL 解析
  const isCustomScheme = dsn.startsWith('meilisearch://');
  const normalized = isCustomScheme ? dsn.replace(/^meilisearch:\/\//, 'http://') : dsn;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch (err) {
    throw new Error(`Failed to parse Meilisearch DSN: ${(err as Error).message}`);
  }

  // 提取 apiKey：优先 URL password/username，次选 query 参数
  const rawKey = url.password || url.username || url.searchParams.get('apiKey') || undefined;
  const apiKey = rawKey ? decodeURIComponent(rawKey) : undefined;

  // 构建标准 host：自定义 scheme 下由 ?tls=true 决定，标准 http(s) DSN 直接沿用其协议
  const tlsEnabled = url.searchParams.get('tls') === 'true';
  const protocol = isCustomScheme ? (tlsEnabled ? 'https' : 'http') : url.protocol.replace(':', '');
  const host = `${protocol}://${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : ''}`;

  return {
    host,
    apiKey,
  };
}

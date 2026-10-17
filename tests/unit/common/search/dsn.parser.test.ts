import { describe, expect, it } from 'vitest';

import { parseMeilisearchDsn } from '@/common/search/utils/dsn.parser';

describe('Meilisearch DSN Parser', () => {
  it('应成功解析带有 masterKey 的 meilisearch:// URL', () => {
    const config = parseMeilisearchDsn('meilisearch://masterKey@127.0.0.1:7700');
    expect(config.host).toBe('http://127.0.0.1:7700');
    expect(config.apiKey).toBe('masterKey');
  });

  it('应成功解析带有 :password 格式密钥的 meilisearch:// URL', () => {
    const config = parseMeilisearchDsn('meilisearch://:secret123@localhost:7700');
    expect(config.host).toBe('http://localhost:7700');
    expect(config.apiKey).toBe('secret123');
  });

  it('应支持 tls=true 参数转换为 https 协议', () => {
    const config = parseMeilisearchDsn('meilisearch://adminKey@search.internal:7700?tls=true');
    expect(config.host).toBe('https://search.internal:7700');
    expect(config.apiKey).toBe('adminKey');
  });

  it('应支持标准 HTTP/HTTPS URL 与 apiKey query 参数', () => {
    const config = parseMeilisearchDsn('https://meili.example.com:7700?apiKey=prodKey');
    expect(config.host).toBe('https://meili.example.com:7700');
    expect(config.apiKey).toBe('prodKey');
  });

  it('应支持无密钥与带子路径的 URL', () => {
    const config = parseMeilisearchDsn('http://127.0.0.1:7700/v1/');
    expect(config.host).toBe('http://127.0.0.1:7700/v1');
    expect(config.apiKey).toBeUndefined();
  });

  it('输入空或非法字符串时应抛出清晰异常', () => {
    expect(() => parseMeilisearchDsn('')).toThrow('Invalid Meilisearch DSN');
    expect(() => parseMeilisearchDsn(':::invalid:::')).toThrow('Failed to parse Meilisearch DSN');
  });
});

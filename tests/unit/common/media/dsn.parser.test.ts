import { describe, expect, it } from 'vitest';

import { parseImgproxyDsn } from '@/common/media/imgproxy/dsn.parser';

describe('parseImgproxyDsn', () => {
  it('成功解析标准 imgproxy:// 协议 DSN', () => {
    const dsn = 'imgproxy://a1b2c3d4:e5f60718@localhost:8080';
    const config = parseImgproxyDsn(dsn);

    expect(config.key).toBe('a1b2c3d4');
    expect(config.salt).toBe('e5f60718');
    expect(config.endpoint).toBe('http://localhost:8080');
    expect(config.publicUrl).toBe('http://localhost:8080');
  });

  it('成功解析带 publicUrl 查询参数的 DSN', () => {
    const dsn = 'imgproxy://key123:salt456@imgproxy-internal:8080?publicUrl=https://cdn.example.com/images';
    const config = parseImgproxyDsn(dsn);

    expect(config.key).toBe('key123');
    expect(config.salt).toBe('salt456');
    expect(config.endpoint).toBe('http://imgproxy-internal:8080');
    expect(config.publicUrl).toBe('https://cdn.example.com/images');
  });

  it('成功解析带 tls=true 的 DSN 并默认转换为 https 和 443', () => {
    const dsn = 'imgproxy://key123:salt456@img.example.com?tls=true';
    const config = parseImgproxyDsn(dsn);

    expect(config.key).toBe('key123');
    expect(config.salt).toBe('salt456');
    expect(config.endpoint).toBe('https://img.example.com');
    expect(config.publicUrl).toBe('https://img.example.com');
  });

  it('成功解析标准 http(s) URL 并通过 query params 携带 key 与 salt', () => {
    const dsn = 'https://imgproxy.internal:8443?key=mykey&salt=mysalt&publicUrl=https://media.mycorp.com';
    const config = parseImgproxyDsn(dsn);

    expect(config.key).toBe('mykey');
    expect(config.salt).toBe('mysalt');
    expect(config.endpoint).toBe('https://imgproxy.internal:8443');
    expect(config.publicUrl).toBe('https://media.mycorp.com');
  });

  it('空字符串或非字符串应抛出错误', () => {
    expect(() => parseImgproxyDsn('')).toThrow('imgproxy DSN 字符串不能为空');
    expect(() => parseImgproxyDsn('   ')).toThrow('imgproxy DSN 字符串不能为空');
  });

  it('缺少 key 或 salt 时应抛出错误', () => {
    expect(() => parseImgproxyDsn('imgproxy://localhost:8080')).toThrow('必须包含 key 与 salt');
    expect(() => parseImgproxyDsn('imgproxy://onlykey@localhost:8080')).toThrow('必须包含 key 与 salt');
  });

  it('非法 URL 格式应抛出错误', () => {
    expect(() => parseImgproxyDsn('invalid-dsn-string-without-proto')).toThrow('无法解析 imgproxy DSN');
  });
});

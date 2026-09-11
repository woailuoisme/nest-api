import type { ImgproxyConfig } from './imgproxy.interface';

/**
 * 解析 imgproxy 统一连接 DSN 字符串
 *
 * 格式示例:
 * 1. 标准 DSN 格式:
 *    imgproxy://9348e3a2b1...:5678f1a2b3...@localhost:8080?publicUrl=http://localhost:8080
 * 2. 带 TLS 的 DSN:
 *    imgproxy://key:salt@img.example.com?tls=true
 * 3. 标准 HTTP(S) URL:
 *    http://localhost:8080?key=9348e3a2b1...&salt=5678f1a2b3...
 */
export function parseImgproxyDsn(dsn: string): ImgproxyConfig {
  if (!dsn || typeof dsn !== 'string' || !dsn.trim()) {
    throw new Error('imgproxy DSN 字符串不能为空');
  }

  const trimmed = dsn.trim();
  const isImgproxyProto = trimmed.startsWith('imgproxy://');
  const normalizedUrl = isImgproxyProto ? `http://${trimmed.slice('imgproxy://'.length)}` : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch (err) {
    throw new Error(`无法解析 imgproxy DSN: 非法 URL 格式 [${trimmed}]`, { cause: err });
  }

  const tlsParam = parsed.searchParams.get('tls');
  const isTls = isImgproxyProto ? tlsParam === 'true' || tlsParam === '1' : parsed.protocol === 'https:';

  const protocol = isTls ? 'https' : 'http';
  const host = parsed.hostname;
  const port = parsed.port || (isTls ? '443' : '8080');

  const key = parsed.username || parsed.searchParams.get('key') || '';
  const salt = parsed.password || parsed.searchParams.get('salt') || '';

  if (!key || !salt) {
    throw new Error(`imgproxy DSN 必须包含 key 与 salt 签名凭据 [${trimmed}]`);
  }

  const isDefaultPort = (protocol === 'http' && port === '80') || (protocol === 'https' && port === '443');
  const endpoint = `${protocol}://${host}${isDefaultPort ? '' : `:${port}`}`;
  const publicUrl = parsed.searchParams.get('publicUrl')?.replace(/\/+$/, '') || endpoint;

  return {
    key,
    salt,
    endpoint,
    publicUrl,
  };
}

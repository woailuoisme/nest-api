import { createHash, createHmac } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { InMemoryDisk, LocalDisk, S3Disk, type StorageModuleOptions } from '@nestjs/storage';
import { compact } from 'es-toolkit';

import { PATHS } from '@/common/constants/app.constants';

export interface S3DriverConfig {
  key?: string;
  secret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  publicUrl?: string;
}

/**
 * 解析标准 S3 DSN URL
 * 支持格式：
 * - 自定义 S3/MinIO/Garage/R2: s3://key:secret@endpoint:port/bucket?region=garage&publicUrl=https://cdn.domain.com
 * - AWS 标准 S3: s3://key:secret@s3.us-east-1.amazonaws.com/bucket
 */
export function parseS3Url(rawUrl: string): S3DriverConfig {
  if (!rawUrl || typeof rawUrl !== 'string') return {};
  if (
    !rawUrl.startsWith('s3://') &&
    !rawUrl.startsWith('s3s://') &&
    !rawUrl.startsWith('http://') &&
    !rawUrl.startsWith('https://')
  ) {
    return {};
  }
  try {
    const isS3Proto = rawUrl.startsWith('s3://');
    const normalized = isS3Proto ? rawUrl.replace(/^s3:\/\//, 'http://') : rawUrl;
    const parsed = new URL(normalized);
    if (!parsed.host) return {};

    const key = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const secret = parsed.password ? decodeURIComponent(parsed.password) : undefined;

    const pathParts = compact(parsed.pathname.split('/'));
    const bucket = pathParts[0] || undefined;

    const region = parsed.searchParams.get('region') || undefined;
    const publicUrl = parsed.searchParams.get('publicUrl') || undefined;

    const isSsl =
      rawUrl.startsWith('https://') ||
      rawUrl.startsWith('s3s://') ||
      parsed.port === '443' ||
      parsed.searchParams.get('ssl') === 'true' ||
      parsed.searchParams.get('tls') === 'true';

    const isAwsHost = parsed.hostname.endsWith('amazonaws.com');
    const endpoint = isAwsHost ? undefined : `${isSsl ? 'https' : 'http'}://${parsed.host}`;

    return {
      key,
      secret,
      bucket,
      region: region || (isAwsHost ? parsed.hostname.split('.')[1] : undefined) || 'us-east-1',
      endpoint,
      publicUrl,
    };
  } catch {
    return {};
  }
}

/**
 * 组装 NestJS Storage 模块选项
 */
export function createStorageOptions(config: ConfigService): StorageModuleOptions {
  const defaultDisk = config.get<string>('FILESYSTEM_DISK') ?? (config.get('STORAGE_S3_URL') ? 's3' : 'local');
  const localRoot = config.get<string>('STORAGE_LOCAL_ROOT', `./${PATHS.STORAGE_UPLOADS}`);
  const appUrl = config.get<string>('APP_URL') ?? 'http://localhost:4300';
  const localPublicUrl = `${appUrl.replace(/\/$/, '')}/uploads`;

  const disks: Record<string, InstanceType<typeof LocalDisk | typeof S3Disk | typeof InMemoryDisk>> = {
    local: new LocalDisk({
      root: localRoot,
      publicUrl: localPublicUrl,
    }),
    memory: new InMemoryDisk({
      publicUrl: `${appUrl.replace(/\/$/, '')}/memory`,
    }),
  };

  const rawS3Url = config.get<string>('STORAGE_S3_URL');
  if (rawS3Url) {
    const s3Config = parseS3Url(rawS3Url);
    if (s3Config.bucket) {
      const region = s3Config.region ?? 'us-east-1';
      const fallbackPublicUrl = s3Config.endpoint
        ? `${s3Config.endpoint.replace(/\/$/, '')}/${s3Config.bucket}`
        : `https://${s3Config.bucket}.s3.${region}.amazonaws.com`;

      disks.s3 = new S3Disk({
        bucket: s3Config.bucket,
        region,
        endpoint: s3Config.endpoint,
        forcePathStyle: Boolean(s3Config.endpoint),
        credentials:
          s3Config.key && s3Config.secret
            ? {
                accessKeyId: s3Config.key,
                secretAccessKey: s3Config.secret,
              }
            : undefined,
        publicUrl: s3Config.publicUrl ?? fallbackPublicUrl,
      });
    }
  }

  return {
    default: defaultDisk,
    disks,
  };
}

// ── S3 基础轻量 SigV4 请求执行器（用于 app:init 幂等创建 Bucket，无需重型 SDK）──────

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function getS3BucketUrl(config: S3DriverConfig): URL {
  const { endpoint, bucket, region = 'us-east-1' } = config;
  if (endpoint) {
    return new URL(`${endpoint.replace(/\/$/, '')}/${bucket}`);
  }
  return new URL(`https://${bucket}.s3.${region}.amazonaws.com`);
}

function signS3Request(config: S3DriverConfig, method: string, url: URL, body = ''): Record<string, string> {
  const { key = '', secret = '', region = 'us-east-1' } = config;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${key}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/** 桶是否存在（404 → false；403 视为存在但无 HeadBucket 权限） */
export async function checkS3BucketExists(config: S3DriverConfig): Promise<boolean> {
  if (!config.bucket) return false;
  const url = getS3BucketUrl(config);
  const headers = signS3Request(config, 'HEAD', url);

  try {
    const res = await fetch(url, { method: 'HEAD', headers });
    if (res.status === 200 || res.status === 403) return true;
    if (res.status === 404) return false;
    return false;
  } catch {
    return false;
  }
}

/** 确保桶存在（不存在则创建），返回是否新建 */
export async function ensureS3Bucket(config: S3DriverConfig): Promise<{ created: boolean }> {
  if (!config.bucket) return { created: false };
  if (await checkS3BucketExists(config)) {
    return { created: false };
  }

  const url = getS3BucketUrl(config);
  const { endpoint, region = 'us-east-1' } = config;
  const withLocation = !endpoint && region !== 'us-east-1';
  const body = withLocation
    ? `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`
    : '';

  const headers = signS3Request(config, 'PUT', url, body);
  if (body) {
    headers['content-type'] = 'application/xml';
  }

  const res = await fetch(url, { method: 'PUT', headers, body: body || undefined });
  return { created: res.ok };
}

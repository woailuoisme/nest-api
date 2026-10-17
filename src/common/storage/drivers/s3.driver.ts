import type { Readable } from 'node:stream';

import { compact } from 'es-toolkit';

import type { PutOptions, StorageDriver } from '@/common/storage/interfaces/storage.interface';

// ─── 类型声明（避免 @aws-sdk 硬依赖） ─────────────────────

type S3Client = { send: (command: unknown) => Promise<unknown> };
type S3Module = Record<string, new (input: Record<string, unknown>) => unknown>;
type Presigner = { getSignedUrl: (client: unknown, cmd: unknown, opts: { expiresIn: number }) => Promise<string> };

interface ListResult {
  Contents?: { Key: string }[];
}

const S3_REQUIRED_MSG =
  'S3 Storage Driver requires "@aws-sdk/client-s3". Run `bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` to use S3/R2/Garage/OSS storage.';

const PRESIGNER_REQUIRED_MSG =
  'getSignedUrl requires "@aws-sdk/s3-request-presigner". Run `bun add @aws-sdk/s3-request-presigner`.';

// ─── Driver ──────────────────────────────────────────────

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
  if (!rawUrl) return {};
  try {
    const isS3Proto = rawUrl.startsWith('s3://');
    const normalized = isS3Proto ? rawUrl.replace(/^s3:\/\//, 'http://') : rawUrl;
    const parsed = new URL(normalized);

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

export class S3StorageDriver implements StorageDriver {
  readonly config: S3DriverConfig;
  #client: S3Client | null = null;
  #s3Module: S3Module | null = null;

  constructor(config: S3DriverConfig | string = {}) {
    this.config = typeof config === 'string' ? parseS3Url(config) : config;
  }

  // ── 动态加载 ──────────────────────────────────────────

  async #ensureClient(): Promise<S3Client> {
    if (this.#client) return this.#client;

    try {
      const module = (await import('@aws-sdk/client-s3')) as unknown as S3Module;
      this.#s3Module = module;
      this.#client = new module.S3Client({
        region: this.config.region ?? 'us-east-1',
        endpoint: this.config.endpoint ?? undefined,
        credentials:
          this.config.key && this.config.secret
            ? { accessKeyId: this.config.key, secretAccessKey: this.config.secret }
            : undefined,
        forcePathStyle: !!this.config.endpoint,
      }) as S3Client;

      return this.#client;
    } catch (cause) {
      throw new Error(S3_REQUIRED_MSG, { cause });
    }
  }

  #createCommand(name: string, input: Record<string, unknown>): unknown {
    if (!this.#s3Module) throw new Error('S3 Storage Driver not initialized');
    return new this.#s3Module[name](input);
  }

  async #send<T = unknown>(commandName: string, input: Record<string, unknown>): Promise<T> {
    return (await this.#ensureClient()).send(this.#createCommand(commandName, input)) as T;
  }

  // ── 公开方法 ──────────────────────────────────────────

  async put(path: string, contents: Buffer | Readable | string, options?: PutOptions): Promise<string> {
    await this.#send('PutObjectCommand', {
      Bucket: this.config.bucket,
      Key: path,
      Body: contents,
      ContentType: options?.contentType,
    });
    return this.getUrl(path);
  }

  async get(path: string): Promise<Buffer> {
    const { Body } = await this.#send<{ Body: Readable }>('GetObjectCommand', {
      Bucket: this.config.bucket,
      Key: path,
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(path: string): Promise<void> {
    await this.#send('DeleteObjectCommand', { Bucket: this.config.bucket, Key: path });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.#send('HeadObjectCommand', { Bucket: this.config.bucket, Key: path });
      return true;
    } catch (err: unknown) {
      const error = err as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      if (
        error?.name === 'NotFound' ||
        error?.name === 'NoSuchKey' ||
        error?.code === 'NotFound' ||
        error?.code === 'NoSuchKey' ||
        error?.$metadata?.httpStatusCode === 404 ||
        error?.message?.includes('NotFound')
      ) {
        return false;
      }
      throw err;
    }
  }

  async deleteBatch(paths: string[]): Promise<void> {
    await this.#send('DeleteObjectsCommand', {
      Bucket: this.config.bucket,
      Delete: { Objects: paths.map((Key) => ({ Key })), Quiet: true },
    });
  }

  async list(prefix: string): Promise<string[]> {
    const { Contents = [] } = await this.#send<ListResult>('ListObjectsV2Command', {
      Bucket: this.config.bucket,
      Prefix: prefix,
    });
    return Contents.map((o) => o.Key);
  }

  getUrl(path: string): string {
    const { publicUrl, endpoint, bucket, region } = this.config;
    const slashed = (s: string) => (s.startsWith('/') ? s : `/${s}`);

    if (publicUrl) return `${publicUrl.replace(/\/$/, '')}${slashed(path)}`;
    if (endpoint) return `${endpoint}/${bucket}/${path}`;

    return `https://${bucket}.s3.${region ?? 'us-east-1'}.amazonaws.com/${path}`;
  }

  urlToPath(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    const { publicUrl, endpoint, bucket } = this.config;

    // 1. 匹配 publicUrl
    if (publicUrl && url.startsWith(publicUrl)) {
      return url.slice(publicUrl.length).replace(/^\/+/, '');
    }

    // 2. 匹配 endpoint
    if (endpoint && url.startsWith(endpoint)) {
      const pathPart = url.slice(endpoint.length).replace(/^\/+/, '');
      if (bucket && pathPart.startsWith(`${bucket}/`)) {
        return pathPart.slice(`${bucket}/`.length);
      }
      return pathPart;
    }

    // 3. 匹配默认 S3 域名格式 https://bucket.s3.region.amazonaws.com/path
    if (bucket && url.includes(bucket)) {
      const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = url.match(new RegExp(`${escapedBucket}[^/]*/(.*)$`));
      if (match) return match[1].replace(/^\/+/, '');
    }

    return null;
  }

  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const client = await this.#ensureClient();
    const command = this.#createCommand('GetObjectCommand', {
      Bucket: this.config.bucket,
      Key: path,
    });

    try {
      const { getSignedUrl } = (await import('@aws-sdk/s3-request-presigner')) as unknown as Presigner;
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    } catch (cause) {
      throw new Error(PRESIGNER_REQUIRED_MSG, { cause });
    }
  }
}

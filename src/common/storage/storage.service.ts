import { Readable } from 'node:stream';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Storage,
  type StorageBody,
  type StorageDisk,
  type StorageDownload,
  type StorageGetOptions,
  type StorageListOptions,
  type StorageListPage,
  type StoragePutOptions,
  type StorageSignedUrlRequest,
  type StorageWriteResult,
} from '@nestjs/storage';

import {
  checkS3BucketExists,
  createStorageOptions,
  ensureS3Bucket,
  parseS3Url,
  type S3DriverConfig,
} from './storage.config';

/**
 * 统一存储服务门面 — 继承自 @nestjs/storage 核心能力，
 * 直接使用原生 StorageDisk，并提供业务所需的 URL 反解与 S3 环境准备辅助。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly defaultDisk: string;
  private readonly storageInstance: Storage;
  private readonly s3Config: S3DriverConfig | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(Storage) injectedStorage?: Storage,
  ) {
    this.defaultDisk = config.get<string>('FILESYSTEM_DISK') ?? (config.get('STORAGE_S3_URL') ? 's3' : 'local');

    const rawS3Url = config.get<string>('STORAGE_S3_URL');
    if (rawS3Url) {
      this.s3Config = parseS3Url(rawS3Url);
    }

    if (injectedStorage) {
      this.storageInstance = injectedStorage;
    } else {
      const options = createStorageOptions(config);
      const diskMap = new Map<string, StorageDisk>(Object.entries(options.disks ?? {}));
      this.storageInstance = new Storage(diskMap, this.defaultDisk);
    }

    this.logInit();
  }

  /** 获取原生 @nestjs/storage Storage 实例 */
  get rawStorage(): Storage {
    return this.storageInstance;
  }

  /** 获取指定名称或默认磁盘的原生 StorageDisk */
  disk(name?: string): StorageDisk {
    const diskName = name ?? this.defaultDisk;
    try {
      return this.storageInstance.disk(diskName);
    } catch {
      throw new Error(`Storage disk "${diskName}" is not configured.`);
    }
  }

  // ── 默认磁盘便捷委托方法 ──────────────────────────────────────

  put(path: string, contents: StorageBody, options?: StoragePutOptions): Promise<StorageWriteResult> {
    return this.disk().put(path, contents, options);
  }

  get(path: string, options?: StorageGetOptions): Promise<StorageDownload> {
    return this.disk().get(path, options);
  }

  getBuffer(path: string): Promise<Buffer> {
    return this.disk().getBuffer(path);
  }

  async getStream(path: string): Promise<Readable> {
    const download = await this.disk().get(path);
    return Readable.from(download.body);
  }

  delete(paths: string | readonly string[]): Promise<void> {
    return this.disk().delete(paths);
  }

  deleteBatch(paths: string[]): Promise<void> {
    return this.disk().delete(paths);
  }

  exists(path: string): Promise<boolean> {
    return this.disk().exists(path);
  }

  url(path: string): string {
    return this.disk().url(path);
  }

  getUrl(path: string): string {
    return this.url(path);
  }

  signedUrl(path: string, options?: StorageSignedUrlRequest): Promise<string> {
    return this.disk().signedUrl(path, options);
  }

  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    try {
      return await this.disk().signedUrl(path, { expiresIn: `${expiresInSeconds}s` });
    } catch {
      return this.url(path);
    }
  }

  list(prefixOrOptions?: string | StorageListOptions): Promise<StorageListPage> {
    const options = typeof prefixOrOptions === 'string' ? { prefix: prefixOrOptions } : prefixOrOptions;
    return this.disk().list(options);
  }

  // ── 业务辅助方法：URL 反解相对路径（供删除旧头像/媒体文件业务使用） ─────────

  urlToPath(url: string, diskName?: string): string | null {
    if (!url || typeof url !== 'string') return null;

    const targetDisk = diskName ?? this.defaultDisk;

    if (targetDisk === 'local') {
      if (!url.includes('/uploads/')) return null;
      const pathPart = url.slice(url.indexOf('/uploads/') + '/uploads/'.length).replace(/^\/+/, '');
      if (!pathPart || pathPart.startsWith('/') || pathPart.split('/').includes('..')) return null;
      return pathPart;
    }

    if (targetDisk === 's3' && this.s3Config) {
      const { publicUrl, endpoint, bucket } = this.s3Config;

      if (publicUrl && url.startsWith(publicUrl)) {
        return url.slice(publicUrl.length).replace(/^\/+/, '');
      }

      if (endpoint && url.startsWith(endpoint)) {
        const pathPart = url.slice(endpoint.length).replace(/^\/+/, '');
        if (bucket && pathPart.startsWith(`${bucket}/`)) {
          return pathPart.slice(`${bucket}/`.length);
        }
        return pathPart;
      }

      if (bucket && url.includes(bucket)) {
        const escaped = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = url.match(new RegExp(`${escaped}[^/]*/(.*)$`));
        if (match?.[1]) return match[1].replace(/^\/+/, '');
      }
    }

    return null;
  }

  // ── S3 专用辅助（用于 app:init 迁移与环境检查）─────────

  isS3Configured(): boolean {
    return Boolean(this.s3Config?.bucket);
  }

  getS3Config(): S3DriverConfig | null {
    return this.s3Config;
  }

  async checkS3BucketExists(): Promise<boolean> {
    if (!this.s3Config) return false;
    return checkS3BucketExists(this.s3Config);
  }

  async ensureS3Bucket(): Promise<{ created: boolean }> {
    if (!this.s3Config) return { created: false };
    return ensureS3Bucket(this.s3Config);
  }

  // ── 初始化日志 ────────────────────────────────────────

  private logInit(): void {
    const detail =
      this.defaultDisk === 's3'
        ? `endpoint=${this.s3Config?.endpoint ?? 'aws'}, bucket=${this.s3Config?.bucket ?? '-'}`
        : `default=${this.defaultDisk}`;
    this.logger.debug(`Storage initialized: ${this.defaultDisk} driver (${detail})`);
  }
}

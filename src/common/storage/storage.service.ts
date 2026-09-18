import { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PATHS } from '@/common/constants/app.constants';
import { LocalStorageDriver } from './drivers/local.driver';
import { S3StorageDriver } from './drivers/s3.driver';
import type { PutOptions, StorageDriver } from './interfaces/storage.interface';

/**
 * 多磁盘存储门面 — 默认透传到配置的 driver，
 * 可选方法在 driver 不支持时提供优雅回退。
 */
@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  readonly #drivers = new Map<string, StorageDriver>();
  readonly #defaultDisk: string;

  constructor(config: ConfigService) {
    this.#defaultDisk = config.get<string>('STORAGE_DRIVER') ?? (config.get('STORAGE_S3_URL') ? 's3' : 'local');
    this.#bootstrap(config);
    this.#logInit(config);
  }

  disk(name?: string): StorageDriver {
    const driver = this.#drivers.get(name ?? this.#defaultDisk);
    if (!driver) throw new Error(`Storage disk "${name ?? this.#defaultDisk}" is not configured.`);
    return driver;
  }

  // ── 委托方法 ──────────────────────────────────────────

  put(path: string, contents: Buffer | Readable | string, options?: PutOptions): Promise<string> {
    return this.disk().put(path, contents, options);
  }

  get(path: string): Promise<Buffer> {
    return this.disk().get(path);
  }

  delete(path: string): Promise<void> {
    return this.disk().delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.disk().exists(path);
  }

  getUrl(path: string): string {
    return this.disk().getUrl(path);
  }

  urlToPath(url: string, diskName?: string): string | null {
    const driver = this.disk(diskName);
    return driver.urlToPath?.(url) ?? null;
  }

  // ── 可选方法 + 回退 ───────────────────────────────────

  async getStream(path: string): Promise<Readable> {
    const driver = this.disk();
    return driver.getStream?.(path) ?? Readable.from(await driver.get(path));
  }

  async deleteBatch(paths: string[]): Promise<void> {
    const driver = this.disk();
    if (driver.deleteBatch) return driver.deleteBatch(paths);
    // 无批量删除 → 逐个删除
    await Promise.all(paths.map((p) => driver.delete(p)));
  }

  async list(prefix: string): Promise<string[]> {
    const driver = this.disk();
    if (driver.list) return driver.list(prefix);
    throw new Error(`Storage disk "${this.#defaultDisk}" does not support list().`);
  }

  async getSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const driver = this.disk();
    return driver.getSignedUrl?.(path, expiresInSeconds) ?? driver.getUrl(path);
  }

  // ── 初始化 ────────────────────────────────────────────

  /**
   * 初始化存储驱动映射。
   *
   * 使用 `new` 直接实例化 LocalStorageDriver 和 S3StorageDriver，
   * 而非通过 NestJS DI 注入，因为这两个驱动类是无依赖的纯配置驱动类 —
   * 构造函数仅接收配置字符串/对象，不依赖任何 NestJS provider。
   * 直接实例化可简化初始化流程，避免不必要的 DI 模板代码。
   */
  #bootstrap(config: ConfigService): void {
    this.#drivers.set(
      'local',
      new LocalStorageDriver(config.get<string>('STORAGE_LOCAL_ROOT', `./${PATHS.STORAGE_UPLOADS}`)),
    );
    this.#drivers.set('s3', new S3StorageDriver(config.get<string>('STORAGE_S3_URL') || ''));
  }

  /**
   * 启动时打印当前存储配置（driver + 关键参数）。
   * 注意：这是「已配置」而非「已连接」——storage 无长连接概念，
   * S3/Garage 走 HTTP 请求-响应，不验证远端可达性。
   */
  #logInit(config: ConfigService): void {
    const s3Driver = this.#drivers.get('s3') as S3StorageDriver | undefined;
    const detail =
      this.#defaultDisk === 's3'
        ? `endpoint=${s3Driver?.config.endpoint ?? '-'}, bucket=${s3Driver?.config.bucket ?? '-'}`
        : `root=${config.get<string>('STORAGE_LOCAL_ROOT', `./${PATHS.STORAGE_UPLOADS}`)}`;
    this.logger.debug(`Storage initialized: ${this.#defaultDisk} driver (${detail})`);
  }
}

import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PATHS } from '@/common/constants/app.constants';
import type { PutOptions, StorageDriver } from '@/common/storage/interfaces/storage.interface';

export class LocalStorageDriver implements StorageDriver {
  readonly #root: string;

  constructor(rootPath = `./${PATHS.STORAGE_UPLOADS}`) {
    this.#root = resolve(rootPath);
  }

  /**
   * 将存储相对路径解析为绝对路径，并强制留在存储根目录内。
   *
   * `join()` 会消解 `..` 但不会限制范围：`join(root, '/uploads/../../etc/passwd')`
   * 会逃出根目录。`urlToPath` + `delete()` 组合把外部传入的 URL 直接送到 `unlink`，
   * 因此必须在唯一的落地入口做容器校验，而不是逐个调用点做字符串过滤。
   */
  #fullPath(path: string): string {
    const absolute = resolve(this.#root, path);
    if (absolute !== this.#root && !absolute.startsWith(this.#root + sep)) {
      throw new Error(`Storage path escapes root: ${path}`);
    }
    return absolute;
  }

  async put(path: string, contents: Buffer | Readable | string, _options?: PutOptions): Promise<string> {
    const dest = this.#fullPath(path);
    await fs.mkdir(dirname(dest), { recursive: true });

    if (Buffer.isBuffer(contents) || typeof contents === 'string') {
      await fs.writeFile(dest, contents);
    } else {
      await pipeline(contents, createWriteStream(dest));
    }

    return this.getUrl(path);
  }

  async get(path: string): Promise<Buffer> {
    return fs.readFile(this.#fullPath(path));
  }

  async delete(path: string): Promise<void> {
    try {
      await fs.unlink(this.#fullPath(path));
    } catch (err: unknown) {
      if (isNodeError(err) && err.code !== 'ENOENT') throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.#fullPath(path));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `/uploads${normalized}`;
  }

  urlToPath(url: string): string | null {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;

    const path = url.slice('/uploads/'.length).replace(/^\/+/, '');
    // 拒绝路径穿越与绝对路径：反解结果必须仍落在存储根目录内
    if (!path || path.startsWith('/') || path.split('/').includes('..')) return null;
    return path;
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.#fullPath(prefix);

    const walk = async (current: string): Promise<string[]> => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      const paths: string[] = [];

      for (const entry of entries) {
        const abs = join(current, entry.name);
        if (entry.isDirectory()) {
          paths.push(...(await walk(abs)));
        } else {
          paths.push(relative(this.#root, abs));
        }
      }
      return paths;
    };

    try {
      return await walk(dir);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getSignedUrl(path: string): Promise<string> {
    return this.getUrl(path);
  }
}

/** 判断 err 是否为 NodeJS 系统错误（带 code 属性） */
const isNodeError = (err: unknown): err is NodeJS.ErrnoException => err instanceof Error && 'code' in err;

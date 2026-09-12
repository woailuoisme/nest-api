import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';

import { type MultipartFile, Storage, type StorageFile } from './storage';

export interface DiskStorageFile extends StorageFile {
  dest: string;
  filename: string;
  path: string;
}

export type DiskStorageOptionHandler =
  | ((file: MultipartFile, req: FastifyRequest) => Promise<string> | string)
  | string;

export interface DiskStorageOptions {
  dest?: DiskStorageOptionHandler;
  filename?: DiskStorageOptionHandler;
  removeAfter?: boolean;
}

const executeStorageHandler = (
  file: MultipartFile,
  req: FastifyRequest,
  obj?: DiskStorageOptionHandler,
): string | Promise<string> | undefined => {
  return typeof obj === 'function' ? obj(file, req) : obj;
};

const getUniqueFilename = (filename: string): string => {
  return randomBytes(16).toString('hex') + extname(filename);
};

const ENV_TESTS_STORAGE_TMP_PATH = process.env.__TESTS_TMP_PATH__;

export class DiskStorage extends Storage<DiskStorageFile, DiskStorageOptions> {
  constructor(options?: DiskStorageOptions) {
    super();
    this.options = options;

    if (ENV_TESTS_STORAGE_TMP_PATH != null) {
      this.options = { ...this.options, dest: ENV_TESTS_STORAGE_TMP_PATH };
    }
  }

  async handleFile(file: MultipartFile, req: FastifyRequest): Promise<DiskStorageFile> {
    const filename = await this.getFilename(file, req, this.options?.filename);
    const dest = await this.getFileDestination(file, req, this.options?.dest);

    await mkdir(dest, { recursive: true });

    const filePath = join(dest, filename);
    const stream = createWriteStream(filePath);
    await pipeline(file.file, stream);

    const { encoding, fieldname, mimetype } = file;

    return {
      size: stream.bytesWritten,
      dest,
      filename,
      originalFilename: file.filename,
      path: filePath,
      mimetype,
      encoding,
      fieldname,
    };
  }

  async removeFile(file: DiskStorageFile, force?: boolean): Promise<void> {
    if (!this.options?.removeAfter && !force) return;
    try {
      await unlink(file.path);
    } catch {
      // 忽略文件已不存在的错误
    }
  }

  protected getFilename(
    file: MultipartFile,
    req: FastifyRequest,
    obj?: DiskStorageOptionHandler,
  ): Promise<string> | string {
    return executeStorageHandler(file, req, obj) ?? getUniqueFilename(file.filename);
  }

  protected getFileDestination(
    file: MultipartFile,
    req: FastifyRequest,
    obj?: DiskStorageOptionHandler,
  ): Promise<string> | string {
    return executeStorageHandler(file, req, obj) ?? tmpdir();
  }
}

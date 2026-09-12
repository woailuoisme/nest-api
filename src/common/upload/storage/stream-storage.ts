import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

import { type MultipartFile, Storage, type StorageFile } from './storage';

export interface StreamStorageFile extends StorageFile {
  stream: Readable;
  tempFilePath?: string;
}

export const temporaryFileOutput = (filename: string): string => {
  const safeFileName = normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = resolve(tmpdir(), safeFileName);
  // 确保解析路径位于 tmpdir 下，防范目录穿越
  if (!fullPath.startsWith(resolve(tmpdir() + sep))) {
    throw new Error('Invalid file path');
  }
  return fullPath;
};

export class StreamStorage extends Storage<StreamStorageFile> {
  async handleFile(file: MultipartFile): Promise<StreamStorageFile> {
    const { encoding, mimetype, fieldname } = file;
    const originalFilename = file.filename ?? randomBytes(16).toString('hex');
    const sanitizedName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueTempName = `${randomBytes(16).toString('hex')}-${sanitizedName}`;
    const tempFilePath = temporaryFileOutput(uniqueTempName);

    /**
     * 遵循 Fastify 和 Busboy 契约，及时消费流以解除反压
     * @see https://github.com/fastify/fastify-multipart?tab=readme-ov-file#usage
     */
    const writeStream = createWriteStream(tempFilePath);
    await pipeline(file.file, writeStream);
    const stream = createReadStream(tempFilePath);

    return {
      size: writeStream.bytesWritten,
      stream,
      encoding,
      mimetype,
      fieldname,
      originalFilename,
      tempFilePath,
    };
  }

  async removeFile(file: StreamStorageFile, force?: boolean): Promise<void> {
    if (!force) {
      try {
        await finished(file.stream);
      } catch {
        // ignore
      }
      file.stream.destroy();
    } else if (!file.stream.destroyed) {
      file.stream.destroy();
    }

    const targetPath = file.tempFilePath ?? temporaryFileOutput(file.originalFilename);
    await rm(targetPath).catch(() => {
      // 忽略文件删除失败
    });
  }
}

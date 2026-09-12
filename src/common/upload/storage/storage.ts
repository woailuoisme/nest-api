import type { Readable } from 'node:stream';
import type { MultipartFile as FastifyMultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

export interface StorageFile {
  size: number;
  fieldname: string;
  encoding: string;
  mimetype: string;
  originalFilename: string;
}

export type MultipartFile = Omit<FastifyMultipartFile, 'file'> & {
  value?: unknown;
  file: Readable & { truncated?: boolean; bytesRead?: number };
};

export abstract class Storage<T extends StorageFile = StorageFile, K = unknown> {
  abstract handleFile(file: MultipartFile, req?: FastifyRequest): Promise<T>;
  abstract removeFile(file: T, force?: boolean): Promise<void> | void;
  options?: K;
}

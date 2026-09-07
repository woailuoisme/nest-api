import type { Readable } from 'node:stream';

export type PutOptions = {
  contentType?: string;
};

export type StorageDriver = {
  put(path: string, contents: Buffer | Readable | string, options?: PutOptions): Promise<string>;
  get(path: string): Promise<Buffer>;
  getStream?(path: string): Promise<Readable>;
  delete(path: string): Promise<void>;
  deleteBatch?(paths: string[]): Promise<void>;
  exists(path: string): Promise<boolean>;
  list?(prefix: string): Promise<string[]>;
  getUrl(path: string): string;
  urlToPath?(url: string): string | null;
  getSignedUrl?(path: string, expiresInSeconds?: number): Promise<string>;
};

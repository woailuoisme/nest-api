import type { BusboyConfig } from '@fastify/busboy';

import { DiskStorage, MemoryStorage, type Storage } from '../storage';
import type { UploadFilterHandler } from './filter';

export type UploadOptions<S extends Storage = Storage> = Partial<BusboyConfig> & {
  dest?: string;
  storage?: S;
  filter?: UploadFilterHandler;
};

export type TransformedUploadOptions<S extends Storage = Storage> = UploadOptions<S> & {
  storage: S;
};

export const DEFAULT_UPLOAD_OPTIONS: TransformedUploadOptions<MemoryStorage> = {
  storage: new MemoryStorage(),
};

export function transformUploadOptions<S extends Storage>(opts?: UploadOptions<S>): TransformedUploadOptions<S> {
  if (!opts) {
    return DEFAULT_UPLOAD_OPTIONS as unknown as TransformedUploadOptions<S>;
  }

  const storage =
    opts.dest != null
      ? new DiskStorage({
          dest: opts.dest,
          ...(typeof opts.storage?.options === 'object' ? opts.storage.options : {}),
        })
      : (opts.storage ?? DEFAULT_UPLOAD_OPTIONS.storage);

  return {
    ...opts,
    storage,
  } as unknown as TransformedUploadOptions<S>;
}

import type { FastifyRequest } from 'fastify';

import type { Storage, StorageFile } from '../../storage';
import { transformException } from '../exceptions';
import { createRemoveObservable, removeStorageFiles } from '../file';
import { filterUpload } from '../filter';
import type { TransformedUploadOptions } from '../options';
import { getParts } from '../request';
import { accumulateField } from './body-accumulator';
import type { HandlerResponse } from './types';

export const handleMultipartAnyFiles = async <S extends Storage = Storage>(
  req: FastifyRequest,
  options: TransformedUploadOptions<S>,
): Promise<HandlerResponse & { files: StorageFile[] }> => {
  const parts = getParts<S>(req, options);
  const body: Record<string, unknown> = {};
  const files: StorageFile[] = [];

  try {
    for await (const part of parts) {
      if (part.file) {
        const file = await options.storage.handleFile(part, req);
        if (await filterUpload(options, req, file)) {
          files.push(file);
        }
      } else {
        accumulateField(body, part.fieldname, part.value);
      }
    }
  } catch (error) {
    await removeStorageFiles(options.storage, files, true);
    throw transformException(error as Error);
  }

  return { body, files, remove: createRemoveObservable(options.storage, files) };
};

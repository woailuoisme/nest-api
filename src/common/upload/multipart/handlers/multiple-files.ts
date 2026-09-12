import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Storage, StorageFile } from '../../storage';
import { transformException } from '../exceptions';
import { createRemoveObservable, removeStorageFiles } from '../file';
import { filterUpload } from '../filter';
import type { TransformedUploadOptions } from '../options';
import { getParts } from '../request';
import { accumulateField } from './body-accumulator';
import type { HandlerResponse } from './types';

export const handleMultipartMultipleFiles = async <
  S extends Storage = Storage,
  T extends StorageFile = S extends Storage<infer U> ? U : StorageFile,
>(
  req: FastifyRequest,
  fieldname: string,
  maxCount: number,
  options: TransformedUploadOptions<S>,
): Promise<HandlerResponse & { files: T[] }> => {
  const parts = getParts<S>(req, options);
  const body: Record<string, unknown> = {};
  const files: T[] = [];

  try {
    for await (const part of parts) {
      if (part.file) {
        if (part.fieldname !== fieldname) {
          throw new BadRequestException(`Field ${part.fieldname} doesn't accept files`);
        }
        if (files.length + 1 > maxCount) {
          throw new BadRequestException(`Field ${part.fieldname} accepts max ${maxCount} files`);
        }
        const file = (await options.storage.handleFile(part, req)) as T;
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

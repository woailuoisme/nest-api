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

export const handleMultipartSingleFile = async <
  S extends Storage = Storage,
  F extends StorageFile = S extends Storage<infer U> ? U : StorageFile,
>(
  req: FastifyRequest,
  fieldname: string,
  options: TransformedUploadOptions<S>,
): Promise<HandlerResponse & { file: F | undefined }> => {
  const parts = getParts<S>(req, options);
  const body: Record<string, unknown> = {};
  let file: F | undefined;

  try {
    for await (const part of parts) {
      if (part.file) {
        if (part.fieldname !== fieldname) {
          throw new BadRequestException(`Field ${part.fieldname} doesn't accept file`);
        }
        if (file != null) {
          throw new BadRequestException(`Field ${fieldname} accepts only one file`);
        }

        const processedFile = (await options.storage.handleFile(part, req)) as F;
        if (await filterUpload(options, req, processedFile)) {
          file = processedFile;
        }
      } else {
        accumulateField(body, part.fieldname, part.value);
      }
    }
  } catch (error) {
    await removeStorageFiles(options.storage, file, true);
    throw transformException(error as Error);
  }

  return {
    body,
    file,
    remove: createRemoveObservable(options.storage, file),
  };
};

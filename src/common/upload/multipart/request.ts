import { type ArgumentsHost, BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { MultipartFile, Storage, StorageFile } from '../storage';
import type { UploadOptions } from './options';

export type HttpArgumentsHost = ReturnType<ArgumentsHost['switchToHttp']>;

export type FastifyMultipartRequest<F extends StorageFile = StorageFile> = FastifyRequest & {
  storageFile?: F;
  storageFiles?: F[] | Record<string, F[]>;
};

export type MultipartsIterator = AsyncIterableIterator<MultipartFile>;

export const getMultipartRequest = <F extends StorageFile = StorageFile>(
  ctx: HttpArgumentsHost,
): FastifyMultipartRequest<F> => {
  const req = ctx.getRequest<FastifyMultipartRequest<F>>();
  if (!req.isMultipart()) {
    throw new BadRequestException('Not a multipart request');
  }

  return req;
};

export const getParts = <S extends Storage>(req: FastifyRequest, options: UploadOptions<S>): MultipartsIterator => {
  return req.parts(options) as MultipartsIterator;
};

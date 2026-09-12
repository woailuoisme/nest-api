import { type CallHandler, type ExecutionContext, mixin, type NestInterceptor, type Type } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { cleanupStorageFiles } from '../multipart/file';
import { handleMultipartMultipleFiles } from '../multipart/handlers/multiple-files';
import { type TransformedUploadOptions, transformUploadOptions, type UploadOptions } from '../multipart/options';
import { getMultipartRequest } from '../multipart/request';
import type { Storage } from '../storage';

export function FilesInterceptor<S extends Storage>(
  fieldname: string,
  maxCount = 1,
  options?: UploadOptions<S>,
): Type<NestInterceptor> {
  class MixinInterceptor implements NestInterceptor {
    private readonly options: TransformedUploadOptions<S>;

    constructor() {
      this.options = transformUploadOptions(options);
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      const ctx = context.switchToHttp();
      const req = getMultipartRequest(ctx);

      const { body, files, remove } = await handleMultipartMultipleFiles(req, fieldname, maxCount, this.options);

      req.body = body;
      req.storageFiles = files;

      return next.handle().pipe(cleanupStorageFiles(remove));
    }
  }

  return mixin(MixinInterceptor);
}

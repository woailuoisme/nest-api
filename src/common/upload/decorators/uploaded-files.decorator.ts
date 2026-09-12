import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { getMultipartRequest } from '../multipart/request';
import type { StorageFile } from '../storage/storage';

export const UploadedFiles = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Record<string, StorageFile[]> | StorageFile[] | undefined => {
    const req = getMultipartRequest(ctx.switchToHttp());
    return req?.storageFiles;
  },
);

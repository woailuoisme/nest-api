import {
  catchError,
  concatWith,
  EMPTY,
  from,
  ignoreElements,
  type MonoTypeOperatorFunction,
  type Observable,
  tap,
  throwError,
} from 'rxjs';

import type { Storage, StorageFile } from '../storage';

export type RemoveStorageFiles = (force?: boolean) => Observable<void>;

/**
 * 在请求处理器完成消费后清理临时/存储文件。
 *
 * 成功的处理流程可能返回基于上传文件的可读流，因此清理流程在不阻塞响应流值的情况下触发，
 * 并等待 storage 实现决定合适的文件移除时机。
 * 当发生异常时，由于无需保留响应流，将强制 (force=true) 并在重新抛出异常前完成清理。
 */
export const cleanupStorageFiles =
  <T>(remove: RemoveStorageFiles): MonoTypeOperatorFunction<T> =>
  (source) =>
    source.pipe(
      tap(() => {
        remove().subscribe({
          // 成功响应时清理异步触发。若响应流出错，以 force=true 重试避免文件残留
          error: () => remove(true).subscribe({ error: () => undefined }),
        });
      }),
      catchError((error: unknown) =>
        remove(true).pipe(
          // 若清理本身也发生错误，优先保持主流程错误透出
          catchError(() => EMPTY),
          ignoreElements(),
          concatWith(throwError(() => error)),
        ),
      ),
    );

export type StorageFilesInput<T extends StorageFile = StorageFile> =
  | T
  | (T | undefined)[]
  | Record<string, (T | undefined)[]>
  | undefined
  | null;

export const removeStorageFiles = async <T extends StorageFile = StorageFile>(
  storage: Storage<T>,
  files?: StorageFilesInput<T>,
  force?: boolean,
): Promise<void> => {
  if (!files) return;

  const list: (T | undefined)[] = Array.isArray(files)
    ? files
    : 'size' in files
      ? [files as T]
      : Object.values(files as Record<string, (T | undefined)[]>).flat();

  await Promise.all(list.map((file) => file && storage.removeFile(file, force)));
};

export const createRemoveObservable = <T extends StorageFile = StorageFile>(
  storage: Storage<T>,
  files: StorageFilesInput<T>,
): RemoveStorageFiles => {
  return (force?: boolean) => from(removeStorageFiles(storage, files, force));
};

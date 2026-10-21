import type { StorageDisk, StoragePutOptions } from '@nestjs/storage';

export type PutOptions = StoragePutOptions;

/**
 * 存储磁盘契约
 * 对齐官方 `@nestjs/storage` 原生标准契约。
 */
export type StorageDriver = StorageDisk;

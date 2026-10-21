import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageModule as NestStorageModule } from '@nestjs/storage';

import { createStorageOptions } from './storage.config';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [
    NestStorageModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createStorageOptions,
      isGlobal: true,
    }),
  ],
  providers: [StorageService],
  exports: [StorageService, NestStorageModule],
})
export class StorageModule {}

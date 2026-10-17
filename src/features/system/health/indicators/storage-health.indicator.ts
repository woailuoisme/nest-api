import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { StorageService } from '@/common/storage/storage.service';

@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'storage'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const activeDriver =
      this.configService.get<string>('STORAGE_DRIVER') ?? (this.configService.get('STORAGE_S3_URL') ? 's3' : 'local');

    try {
      await this.storageService.disk(activeDriver).exists('.healthcheck');
      return indicator.up({ driver: activeDriver });
    } catch (error) {
      return indicator.down({
        driver: activeDriver,
        message: (error as Error).message,
      });
    }
  }
}

import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageHealthIndicator } from '@/api/system/health/indicators/storage-health.indicator';
import { StorageService } from '@/common/storage/storage.service';

describe('StorageHealthIndicator', () => {
  let indicator: StorageHealthIndicator;
  let storageService: StorageService;
  let configService: ConfigService;

  beforeEach(() => {
    storageService = {
      disk: vi.fn(),
    } as unknown as StorageService;
    configService = new ConfigService();
    const healthIndicatorService = new HealthIndicatorService();
    indicator = new StorageHealthIndicator(storageService, configService, healthIndicatorService);
  });

  it('should return up status for active s3 driver', async () => {
    vi.spyOn(configService, 'get').mockReturnValue('s3');
    const mockDisk = { exists: vi.fn().mockResolvedValue(true) };
    vi.spyOn(storageService, 'disk').mockReturnValue(mockDisk as any);

    const result = await indicator.isHealthy('storage');
    expect(result).toEqual({ storage: { status: 'up', driver: 's3' } });
    expect(storageService.disk).toHaveBeenCalledWith('s3');
  });

  it('should return up status for active local driver', async () => {
    vi.spyOn(configService, 'get').mockReturnValue('local');
    const mockDisk = { exists: vi.fn().mockResolvedValue(true) };
    vi.spyOn(storageService, 'disk').mockReturnValue(mockDisk as any);

    const result = await indicator.isHealthy('storage');
    expect(result).toEqual({ storage: { status: 'up', driver: 'local' } });
    expect(storageService.disk).toHaveBeenCalledWith('local');
  });

  it('should return down status when disk exists check throws error', async () => {
    vi.spyOn(configService, 'get').mockReturnValue('s3');
    const mockDisk = { exists: vi.fn().mockRejectedValue(new Error('Storage Unreachable')) };
    vi.spyOn(storageService, 'disk').mockReturnValue(mockDisk as any);

    const result = await indicator.isHealthy('storage');
    expect(result).toEqual({
      storage: { status: 'down', driver: 's3', message: 'Storage Unreachable' },
    });
  });
});

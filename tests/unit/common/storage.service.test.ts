import { promises as fsPromises } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/common/constants/app.constants';
import { parseS3Url } from '@/common/storage/storage.config';
import { StorageService } from '@/common/storage/storage.service';

describe('StorageModule Unit Tests', () => {
  const testUploadDir = resolve(process.cwd(), PATHS.STORAGE_TMP, 'storage-test-uploads');

  afterEach(async () => {
    try {
      await fsPromises.rm(testUploadDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── S3 URL Parser ───────────────────────────────────────

  describe('parseS3Url', () => {
    it('should parse standard AWS S3 DSN', () => {
      const config = parseS3Url('s3://my-key:my-secret@s3.us-west-2.amazonaws.com/my-bucket?region=us-west-2');
      expect(config.key).toBe('my-key');
      expect(config.secret).toBe('my-secret');
      expect(config.bucket).toBe('my-bucket');
      expect(config.region).toBe('us-west-2');
      expect(config.endpoint).toBeUndefined();
    });

    it('should parse MinIO / Garage / custom S3 endpoint with publicUrl', () => {
      const config = parseS3Url(
        's3://garage-key:garage-sec@127.0.0.1:3900/assets?region=garage&publicUrl=https://cdn.example.com',
      );
      expect(config.key).toBe('garage-key');
      expect(config.secret).toBe('garage-sec');
      expect(config.bucket).toBe('assets');
      expect(config.region).toBe('garage');
      expect(config.endpoint).toBe('http://127.0.0.1:3900');
      expect(config.publicUrl).toBe('https://cdn.example.com');
    });

    it('should handle TLS flags and s3s protocol', () => {
      const tlsConfig = parseS3Url('s3://key:sec@minio.corp.net:443/data?ssl=true');
      expect(tlsConfig.endpoint).toBe('https://minio.corp.net:443');

      const s3sConfig = parseS3Url('s3s://key:sec@garage.domain.com/bucket');
      expect(s3sConfig.endpoint).toBe('https://garage.domain.com');
    });

    it('should return empty object on empty or invalid URL', () => {
      expect(parseS3Url('')).toEqual({});
      expect(parseS3Url('not-a-valid-url:::')).toEqual({});
    });
  });

  // ── StorageService Local Operations ─────────────────────

  describe('StorageService (Local Disk)', () => {
    let service: StorageService;
    let configService: ConfigService;

    beforeEach(() => {
      configService = new ConfigService({
        FILESYSTEM_DISK: 'local',
        STORAGE_LOCAL_ROOT: testUploadDir,
        APP_URL: 'http://localhost:4300',
      });
      service = new StorageService(configService);
    });

    it('should handle string, buffer, and stream contents on put', async () => {
      const stringResult = await service.put('string.txt', 'string content');
      expect(stringResult.key).toBe('string.txt');
      expect(service.url('string.txt')).toBe('http://localhost:4300/uploads/string.txt');

      const bufferResult = await service.put('buffer.txt', Buffer.from('buffer content'));
      expect(bufferResult.key).toBe('buffer.txt');
      expect(service.url('buffer.txt')).toBe('http://localhost:4300/uploads/buffer.txt');

      const streamResult = await service.put('stream.txt', Readable.from(['stream ', 'content']));
      expect(streamResult.key).toBe('stream.txt');
      expect(service.url('stream.txt')).toBe('http://localhost:4300/uploads/stream.txt');

      expect((await service.getBuffer('string.txt')).toString()).toBe('string content');
      expect((await service.getBuffer('buffer.txt')).toString()).toBe('buffer content');
      expect((await service.getBuffer('stream.txt')).toString()).toBe('stream content');
    });

    it('should check existence, delete files, and be idempotent on missing file delete', async () => {
      await service.put('temp.txt', 'temp data');
      expect(await service.exists('temp.txt')).toBe(true);

      await service.delete('temp.txt');
      expect(await service.exists('temp.txt')).toBe(false);

      // deleting missing file should not throw
      await expect(service.delete('temp.txt')).resolves.toBeUndefined();
    });

    it('should normalize public URLs and signed URLs', async () => {
      expect(service.url('path/to/file.png')).toBe('http://localhost:4300/uploads/path/to/file.png');
      expect(service.getUrl('path/to/file.png')).toBe('http://localhost:4300/uploads/path/to/file.png');
      expect(await service.getSignedUrl('path/to/file.png')).toBe('http://localhost:4300/uploads/path/to/file.png');
      expect(service.urlToPath('/uploads/path/to/file.png')).toBe('path/to/file.png');
      expect(service.urlToPath('http://localhost:4300/uploads/path/to/file.png')).toBe('path/to/file.png');
      expect(service.urlToPath('https://s3.amazonaws.com/abc')).toBeNull();
    });

    it('should reject path traversal in urlToPath', () => {
      expect(service.urlToPath('/uploads/../etc/passwd')).toBeNull();
      expect(service.urlToPath('/uploads/../../secret')).toBeNull();
    });

    it('should getStream from disk', async () => {
      await service.put('stream-test.txt', 'stream content');

      const stream = await service.getStream('stream-test.txt');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).toString()).toBe('stream content');
    });

    it('should deleteBatch multiple files', async () => {
      await service.put('batch/a.txt', 'a');
      await service.put('batch/b.txt', 'b');
      await service.put('batch/c.txt', 'c');

      expect(await service.exists('batch/a.txt')).toBe(true);
      expect(await service.exists('batch/b.txt')).toBe(true);
      expect(await service.exists('batch/c.txt')).toBe(true);

      await service.deleteBatch(['batch/a.txt', 'batch/b.txt', 'batch/c.txt']);

      expect(await service.exists('batch/a.txt')).toBe(false);
      expect(await service.exists('batch/b.txt')).toBe(false);
      expect(await service.exists('batch/c.txt')).toBe(false);
    });

    it('should list files under a prefix', async () => {
      await service.put('list-items/a.txt', 'a');
      await service.put('list-items/b.txt', 'b');
      await service.put('list-items/sub/c.txt', 'c');

      const page = await service.list('list-items');
      expect(page.entries.map((e) => e.key).sort()).toEqual([
        'list-items/a.txt',
        'list-items/b.txt',
        'list-items/sub/c.txt',
      ]);
    });
  });

  // ── StorageService Multi-disk Support ───────────────────

  describe('StorageService (Multi-Disk & S3 Config)', () => {
    it('should access explicitly configured disks and throw for unconfigured disks', () => {
      const configService = new ConfigService({
        FILESYSTEM_DISK: 'local',
        STORAGE_LOCAL_ROOT: testUploadDir,
        STORAGE_S3_URL: 's3://test-key:test-secret@s3.us-east-1.amazonaws.com/test-bucket?region=us-east-1',
      });
      const service = new StorageService(configService);

      const localDisk = service.disk('local');
      expect(localDisk).toBeDefined();

      const s3Disk = service.disk('s3');
      expect(s3Disk).toBeDefined();

      const memoryDisk = service.disk('memory');
      expect(memoryDisk).toBeDefined();

      expect(() => service.disk('unknown')).toThrow('Storage disk "unknown" is not configured.');
    });

    it('should correctly report S3 configuration status', () => {
      const noS3Service = new StorageService(
        new ConfigService({
          FILESYSTEM_DISK: 'local',
          STORAGE_LOCAL_ROOT: testUploadDir,
        }),
      );
      expect(noS3Service.isS3Configured()).toBe(false);
      expect(noS3Service.getS3Config()).toBeNull();

      const s3Service = new StorageService(
        new ConfigService({
          FILESYSTEM_DISK: 's3',
          STORAGE_S3_URL: 's3://key:secret@garage.domain.com/my-bucket',
        }),
      );
      expect(s3Service.isS3Configured()).toBe(true);
      expect(s3Service.getS3Config()?.bucket).toBe('my-bucket');
    });

    it('should support urlToPath for S3 disks with publicUrl', () => {
      const s3Service = new StorageService(
        new ConfigService({
          FILESYSTEM_DISK: 's3',
          STORAGE_S3_URL: 's3://key:secret@127.0.0.1:9000/my-bucket?publicUrl=https://cdn.example.com',
        }),
      );

      const resolved = s3Service.urlToPath('https://cdn.example.com/images/avatar.png', 's3');
      expect(resolved).toBe('images/avatar.png');
    });
  });
});

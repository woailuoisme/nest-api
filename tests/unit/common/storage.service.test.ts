import { promises as fsPromises } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/common/constants/app.constants';
import { LocalStorageDriver } from '@/common/storage/drivers/local.driver';
import { S3StorageDriver } from '@/common/storage/drivers/s3.driver';
import { StorageService } from '@/common/storage/storage.service';

// ─── S3 SDK Mock（文件级 hoisted，所有 S3 测试共享）──────────

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function (this: Record<string, unknown>) {
    this.send = mockSend;
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  DeleteObjectsCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/file.jpg'),
}));

// ─── 共享 fixture ─────────────────────────────────────────

describe('StorageModule Unit Tests', () => {
  const testUploadDir = resolve(process.cwd(), PATHS.STORAGE_TMP, 'storage-test-uploads');

  afterEach(async () => {
    try {
      await fsPromises.rm(testUploadDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── Local ───────────────────────────────────────────────

  describe('LocalStorageDriver', () => {
    let localDriver: LocalStorageDriver;

    beforeEach(() => {
      localDriver = new LocalStorageDriver(testUploadDir);
    });

    it('should handle string, buffer, and stream contents on put', async () => {
      const stringUrl = await localDriver.put('string.txt', 'string content');
      expect(stringUrl).toBe('/uploads/string.txt');

      const bufferUrl = await localDriver.put('buffer.txt', Buffer.from('buffer content'));
      expect(bufferUrl).toBe('/uploads/buffer.txt');

      const streamUrl = await localDriver.put('stream.txt', Readable.from(['stream ', 'content']));
      expect(streamUrl).toBe('/uploads/stream.txt');

      expect((await localDriver.get('string.txt')).toString()).toBe('string content');
      expect((await localDriver.get('buffer.txt')).toString()).toBe('buffer content');
      expect((await localDriver.get('stream.txt')).toString()).toBe('stream content');
    });

    it('should check existence, delete files, and be idempotent on missing file delete', async () => {
      await localDriver.put('temp.txt', 'temp data');
      expect(await localDriver.exists('temp.txt')).toBe(true);

      await localDriver.delete('temp.txt');
      expect(await localDriver.exists('temp.txt')).toBe(false);

      // deleting missing file should not throw
      await expect(localDriver.delete('temp.txt')).resolves.toBeUndefined();
    });

    it('should normalize public URLs and signed URLs', async () => {
      expect(localDriver.getUrl('path/to/file.png')).toBe('/uploads/path/to/file.png');
      expect(await localDriver.getSignedUrl('/path/to/file.png')).toBe('/uploads/path/to/file.png');
      expect(localDriver.urlToPath('/uploads/path/to/file.png')).toBe('path/to/file.png');
      expect(localDriver.urlToPath('https://s3.amazonaws.com/abc')).toBeNull();
    });

    it('should list files recursively under a prefix', async () => {
      await localDriver.put('a/1.txt', 'a1');
      await localDriver.put('a/b/2.txt', 'ab2');
      await localDriver.put('a/c/3.txt', 'ac3');
      await localDriver.put('root.txt', 'root');

      const aFiles = await localDriver.list('a');
      expect(aFiles.sort()).toEqual(['a/1.txt', 'a/b/2.txt', 'a/c/3.txt']);

      const rootFiles = await localDriver.list('');
      expect(rootFiles).toContain('root.txt');
    });

    it('should return empty array when listing a non-existent directory', async () => {
      expect(await localDriver.list('nonexistent')).toEqual([]);
    });
  });

  // ── S3 ──────────────────────────────────────────────────

  describe('S3StorageDriver', () => {
    beforeEach(() => {
      mockSend.mockReset();
    });

    afterEach(() => {
      vi.resetModules();
    });

    const makeDriver = (overrides?: Record<string, string>) =>
      new S3StorageDriver({
        key: 'test-key',
        secret: 'test-secret',
        bucket: 'test-bucket',
        region: 'us-east-1',
        ...overrides,
      });

    it('should parse S3 DSN URL strings correctly in constructor and parseS3Url', () => {
      const driver = new S3StorageDriver(
        's3://mykey:mysecret@garage:3900/mybucket?region=garage&publicUrl=https://cdn.example.com',
      );
      expect(driver.config.key).toBe('mykey');
      expect(driver.config.secret).toBe('mysecret');
      expect(driver.config.bucket).toBe('mybucket');
      expect(driver.config.region).toBe('garage');
      expect(driver.config.endpoint).toBe('http://garage:3900');
      expect(driver.config.publicUrl).toBe('https://cdn.example.com');

      // TLS / HTTPS endpoint 推断
      const tlsDriver = new S3StorageDriver('s3://key:sec@minio.corp.net:443/data?ssl=true');
      expect(tlsDriver.config.endpoint).toBe('https://minio.corp.net:443');

      const s3sDriver = new S3StorageDriver('s3s://key:sec@garage.domain.com/bucket');
      expect(s3sDriver.config.endpoint).toBe('https://garage.domain.com');
    });

    it('should generate correct URLs and parse URLs back to paths for publicUrl, endpoint, and default AWS S3', () => {
      const s3Public = new S3StorageDriver({ publicUrl: 'https://cdn.example.com', bucket: 'my-bucket' });
      expect(s3Public.getUrl('image.jpg')).toBe('https://cdn.example.com/image.jpg');
      expect(s3Public.urlToPath('https://cdn.example.com/image.jpg')).toBe('image.jpg');

      const s3Endpoint = new S3StorageDriver({ endpoint: 'https://garage.minio.local', bucket: 'my-bucket' });
      expect(s3Endpoint.getUrl('image.jpg')).toBe('https://garage.minio.local/my-bucket/image.jpg');
      expect(s3Endpoint.urlToPath('https://garage.minio.local/my-bucket/image.jpg')).toBe('image.jpg');

      const s3Default = new S3StorageDriver({ bucket: 'my-bucket', region: 'us-west-2' });
      expect(s3Default.getUrl('image.jpg')).toBe('https://my-bucket.s3.us-west-2.amazonaws.com/image.jpg');
      expect(s3Default.urlToPath('https://my-bucket.s3.us-west-2.amazonaws.com/image.jpg')).toBe('image.jpg');
    });

    it('should put an object and return its URL', async () => {
      mockSend.mockResolvedValueOnce({});

      const driver = makeDriver();
      const url = await driver.put('image.jpg', Buffer.from('data'), { contentType: 'image/jpeg' });
      expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/image.jpg');
    });

    it('should get an object as Buffer', async () => {
      mockSend.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('hello')]) });

      const driver = makeDriver();
      const result = await driver.get('file.txt');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('hello');
    });

    it('should delete an object', async () => {
      mockSend.mockResolvedValueOnce({});

      const driver = makeDriver();
      await expect(driver.delete('file.txt')).resolves.toBeUndefined();
    });

    it('should return true when object exists', async () => {
      mockSend.mockResolvedValueOnce({});

      const driver = makeDriver();
      expect(await driver.exists('file.txt')).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      mockSend.mockRejectedValueOnce(new Error('NotFound'));

      const driver = makeDriver();
      expect(await driver.exists('file.txt')).toBe(false);
    });

    it('should rethrow unexpected errors (like 403/network failure) during exists check', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied: Forbidden'));

      const driver = makeDriver();
      await expect(driver.exists('file.txt')).rejects.toThrow('AccessDenied');
    });

    it('should delete multiple objects in batch', async () => {
      mockSend.mockResolvedValueOnce({});

      const driver = makeDriver();
      await expect(driver.deleteBatch(['a.txt', 'b.txt'])).resolves.toBeUndefined();
    });

    it('should list objects under a prefix', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'photos/1.jpg' }, { Key: 'photos/2.jpg' }],
      });

      const driver = makeDriver();
      expect(await driver.list('photos/')).toEqual(['photos/1.jpg', 'photos/2.jpg']);
    });

    it('should return empty list when no objects match prefix', async () => {
      mockSend.mockResolvedValueOnce({});

      const driver = makeDriver();
      expect(await driver.list('empty/')).toEqual([]);
    });

    it('should return signed URL via presigner', async () => {
      // 需要两次 send：第一次是 #ensureClient（但 mock 不关心具体命令），
      // 第二次是 getSignedUrl 内部的 #ensureClient 重用已有 client
      // getSignedUrl 调用 #ensureClient → 返回已缓存的 client（不需要 mock send）
      // 然后动态 import presigner → 返回 mock 的 getSignedUrl
      const driver = makeDriver();
      // 先触发一次操作来缓存 client
      mockSend.mockResolvedValueOnce({});
      await driver.put('prime.txt', 'data');

      const url = await driver.getSignedUrl('file.jpg', 7200);
      expect(url).toBe('https://signed.example.com/file.jpg');
    });

    it('should throw friendly error when @aws-sdk/s3-request-presigner is missing', async () => {
      // 先用正常 mock 缓存 client
      await vi.resetModules();
      mockSend.mockResolvedValueOnce({});
      const driver = makeDriver();
      await driver.put('prime.txt', 'data'); // 缓存 #client

      // 覆盖 presigner mock 为抛错
      vi.doMock('@aws-sdk/s3-request-presigner', () => {
        throw new Error('Module not found');
      });

      const { S3StorageDriver: FreshDriver } = await import('@/common/storage/drivers/s3.driver');
      const driver2 = new FreshDriver({
        key: 'k',
        secret: 's',
        bucket: 'b',
      });
      // 先缓存 client（mockSend 仍可用）
      mockSend.mockResolvedValueOnce({});
      await driver2.put('x.txt', 'x');

      await expect(driver2.getSignedUrl('f.jpg')).rejects.toThrow(
        'getSignedUrl requires "@aws-sdk/s3-request-presigner"',
      );
    });

    it('should throw friendly error when @aws-sdk/client-s3 is missing', async () => {
      // 重置模块以清除之前的 doMock 副作用
      await vi.resetModules();

      vi.doMock('@aws-sdk/client-s3', () => {
        throw new Error('Module not found');
      });

      const { S3StorageDriver: FreshDriver } = await import('@/common/storage/drivers/s3.driver');
      const driver = new FreshDriver({ bucket: 'my-bucket' });

      await expect(driver.put('file.txt', 'hello')).rejects.toThrow('S3 Storage Driver requires "@aws-sdk/client-s3"');
    });
  });

  // ── Service ─────────────────────────────────────────────

  describe('StorageService', () => {
    let service: StorageService;
    let configService: ConfigService;

    beforeEach(() => {
      configService = new ConfigService({
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_ROOT: testUploadDir,
        STORAGE_S3_URL: 's3://test-key:test-secret@s3.us-east-1.amazonaws.com/test-bucket?region=us-east-1',
      });
      service = new StorageService(configService);
    });

    it('should delegate operations to default disk', async () => {
      const url = await service.put('delegated.txt', 'hello world');
      expect(url).toBe('/uploads/delegated.txt');

      expect(await service.exists('delegated.txt')).toBe(true);
      expect((await service.get('delegated.txt')).toString()).toBe('hello world');
      expect(service.getUrl('delegated.txt')).toBe('/uploads/delegated.txt');
      expect(await service.getSignedUrl('delegated.txt')).toBe('/uploads/delegated.txt');

      await service.delete('delegated.txt');
      expect(await service.exists('delegated.txt')).toBe(false);
    });

    it('should access explicitly configured disks and throw for unconfigured disks', () => {
      const localDisk = service.disk('local');
      expect(localDisk).toBeInstanceOf(LocalStorageDriver);

      const s3Disk = service.disk('s3');
      expect(s3Disk).toBeInstanceOf(S3StorageDriver);

      expect(() => service.disk('unknown')).toThrow('Storage disk "unknown" is not configured.');
    });

    it('should getStream from local disk (fallback to get + Readable.from)', async () => {
      await service.put('stream-test.txt', 'stream content');

      const stream = await service.getStream('stream-test.txt');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).toString()).toBe('stream content');
    });

    it('should deleteBatch by falling back to sequential delete for local disk', async () => {
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

    it('should delegate list to the disk that supports it', async () => {
      await service.put('list-items/a.txt', 'a');
      await service.put('list-items/b.txt', 'b');
      await service.put('list-items/sub/c.txt', 'c');

      const files = await service.list('list-items');
      expect(files.sort()).toEqual(['list-items/a.txt', 'list-items/b.txt', 'list-items/sub/c.txt']);
    });
  });
});

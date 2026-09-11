import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTestPng } from 'tests/factories/image.factory';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/common/constants/app.constants';
import { THUMBNAIL_PRESETS } from '@/common/media/interfaces/media.interface';
import { MediaService } from '@/common/media/media.service';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import { StorageService } from '@/common/storage/storage.service';
import type { MediaJobs } from '@/jobs/media/media.jobs';

/** 内存模式上传文件工厂 */
function memoryImage(buffer: Buffer, filename = 'test.png', mimetype = 'image/png'): UploadedFile {
  return {
    type: 'memory',
    fieldname: 'file',
    filename,
    mimetype,
    buffer,
    size: buffer.byteLength,
  };
}

/** 流式上传文件工厂 */
function streamFile(tmpPath: string, filename = 'test.png', mimetype = 'image/png', truncated = false): UploadedFile {
  return {
    type: 'stream',
    fieldname: 'file',
    filename,
    mimetype,
    tmpPath,
    truncated,
  };
}

describe('MediaService', () => {
  let mediaService: MediaService;
  let testImageBuffer: Buffer;

  const storageMock = {
    disk: vi.fn().mockReturnThis(),
    put: vi.fn().mockResolvedValue('stored-path'),
    getUrl: vi.fn((path: string) => `/uploads/${path}`),
    urlToPath: vi.fn((url: string) => (url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null)),
    exists: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteBatch: vi.fn().mockResolvedValue(undefined),
  };

  const configServiceMock = {
    get: vi.fn((key: string, defaultVal?: unknown) => {
      if (key === 'IMGPROXY_URL') return 'imgproxy://a1b2c3d4e5f6:0123456789abcdef@localhost:8080';
      if (key === 'MEDIA_QUEUE_ENABLED') return false;
      return defaultVal;
    }),
  };

  const mediaJobsMock = {
    dispatchGenerateVariants: vi.fn().mockResolvedValue({ id: 'media-job-999' }),
    removeJob: vi.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    storageMock.exists.mockResolvedValue(false);
    testImageBuffer = createTestPng(400, 300);
    mediaService = new MediaService(
      storageMock as unknown as StorageService,
      undefined,
      undefined,
      undefined,
      undefined,
      configServiceMock as unknown as ConfigService,
      mediaJobsMock as unknown as MediaJobs,
    );
  });

  describe('save() — 单媒体文件存储与处理', () => {
    it('图片存储：提取元数据并生成默认日期路径，保存原始主图', async () => {
      const file = memoryImage(testImageBuffer, 'avatar.png');
      const result = await mediaService.save(file, { prefix: 'avatars' });

      expect(storageMock.put).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/^avatars\/\d{8}\/[0-9a-f-]{36}\.png$/);
      expect(result.url).toBe(`/uploads/${result.path}`);
      expect(result.isNew).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.width).toBe(400);
      expect(result.metadata?.height).toBe(300);
      expect(result.metadata?.format).toBe('png');
    });

    it('生成缩略图与多规格变体 (imgproxy JIT 动态签名模式，零额外磁盘写入)', async () => {
      const file = memoryImage(testImageBuffer, 'cover.png');
      const result = await mediaService.save(file, {
        prefix: 'covers',
        variants: {
          thumb: THUMBNAIL_PRESETS.thumb,
          medium: { width: 200, format: 'webp' },
        },
      });

      // 仅主图 1 次 put，变体全为即时签名 URL，零磁盘开销
      expect(storageMock.put).toHaveBeenCalledTimes(1);
      expect(result.variants).toBeDefined();
      expect(result.variants?.thumb).toBeDefined();
      expect(result.variants?.medium).toBeDefined();

      expect(result.variants?.thumb.status).toBe('ready');
      expect(result.variants?.thumb.isNew).toBe(false);
      expect(result.variants?.thumb.path).toBe(result.path);
      expect(result.variants?.thumb.url).toMatch(/^http:\/\/localhost:8080\//);
      expect(result.variants?.thumb.url).toContain('rs:fill:150:150');

      expect(result.variants?.medium.status).toBe('ready');
      expect(result.variants?.medium.url).toMatch(/^http:\/\/localhost:8080\//);
      expect(result.variants?.medium.url).toContain('rs:fit:200');
      expect(result.variants?.medium.url).toMatch(/@webp$/);
    });

    it('非图片文件：直接存储，不调用图像处理', async () => {
      const textBuffer = Buffer.from('hello world');
      const file: UploadedFile = {
        type: 'memory',
        fieldname: 'doc',
        filename: 'document.pdf',
        mimetype: 'application/pdf',
        buffer: textBuffer,
        size: textBuffer.byteLength,
      };

      const result = await mediaService.save(file, { prefix: 'docs' });
      expect(storageMock.put).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/^docs\/\d{8}\/[0-9a-f-]{36}\.pdf$/);
      expect(result.metadata).toBeUndefined();
      expect(result.variants).toBeUndefined();
    });

    it('流式文件上传与临时文件清理', async () => {
      const tmpPath = join(PATHS.STORAGE_TMP, `test-${Date.now()}.png`);
      await fs.mkdir(PATHS.STORAGE_TMP, { recursive: true });
      await fs.writeFile(tmpPath, testImageBuffer);

      const file = streamFile(tmpPath, 'streamed.png');
      const result = await mediaService.save(file, { prefix: 'uploads' });

      expect(storageMock.put).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/^uploads\/\d{8}\/[0-9a-f-]{36}\.png$/);

      // 临时文件应已被删除
      const exists = await fs
        .access(tmpPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('流式截断时抛出 PayloadTooLargeException (413) 且不读取到内存', async () => {
      const tmpPath = join(PATHS.STORAGE_TMP, `test-trunc-${Date.now()}.png`);
      await fs.mkdir(PATHS.STORAGE_TMP, { recursive: true });
      await fs.writeFile(tmpPath, testImageBuffer);

      const file = streamFile(tmpPath, 'streamed.png', 'image/png', true);
      await expect(mediaService.save(file)).rejects.toThrow(PayloadTooLargeException);
    });

    it('主图生成写入失败时自动安全回滚', async () => {
      storageMock.put.mockRejectedValueOnce(new Error('Disk write error'));

      const file = memoryImage(testImageBuffer, 'fail.png');
      await expect(
        mediaService.save(file, {
          prefix: 'covers',
        }),
      ).rejects.toThrow('Disk write error');

      expect(storageMock.deleteBatch).toHaveBeenCalledTimes(1);
    });

    it('hash 去重模式下若文件已存在，回滚时不删除已有共享文件', async () => {
      storageMock.exists.mockResolvedValue(true); // 文件已存在
      storageMock.put.mockRejectedValueOnce(new Error('Transaction Abort'));

      const file = memoryImage(testImageBuffer, 'dup.png');
      await expect(
        mediaService.save(file, {
          naming: 'hash',
        }),
      ).rejects.toThrow('Transaction Abort');

      // 已存在的文件不进入 newlyCreatedPaths，不被 deleteBatch 删除
      expect(storageMock.deleteBatch).not.toHaveBeenCalled();
    });
  });

  describe('url() — imgproxy Fluent 构建器门面', () => {
    it('为存储路径生成合法的 imgproxy 签名 URL', () => {
      const url = mediaService.url('photos/avatar.png').preset('avatar').webp().build();

      expect(url).toMatch(/^http:\/\/localhost:8080\/[A-Za-z0-9_-]+\//);
      expect(url).toContain('rs:fill:200:200');
      expect(url).toContain('g:ce');
      expect(url).toContain('/plain/local:///photos/avatar.png@webp');
    });

    it('支持链式组合 resize、format 与 quality 参数', () => {
      const url = mediaService
        .url('covers/banner.jpg')
        .resize({ width: 800, height: 400, fit: 'cover' })
        .quality(85)
        .avif()
        .build();

      expect(url).toMatch(/^http:\/\/localhost:8080\/[A-Za-z0-9_-]+\//);
      expect(url).toContain('rs:fill:800:400');
      expect(url).toContain('q:85');
      expect(url).toContain('/plain/local:///covers/banner.jpg@avif');
    });
  });

  describe('saveBatch() — 批量媒体上传', () => {
    it('批量存储所有文件并返回结果列表', async () => {
      const files = [memoryImage(testImageBuffer, 'img1.png'), memoryImage(testImageBuffer, 'img2.png')];
      const results = await mediaService.saveBatch(files, { prefix: 'gallery' });

      expect(results).toHaveLength(2);
      expect(storageMock.put).toHaveBeenCalledTimes(2);
    });

    it('批量上传中任一文件失败时回滚已写文件', async () => {
      storageMock.put.mockResolvedValueOnce('img1.png').mockRejectedValueOnce(new Error('Batch Error'));

      const files = [memoryImage(testImageBuffer, 'img1.png'), memoryImage(testImageBuffer, 'img2.png')];
      await expect(
        mediaService.saveBatch(files, {
          prefix: 'gallery',
        }),
      ).rejects.toThrow('Batch Error');

      expect(storageMock.deleteBatch).toHaveBeenCalled();
    });
  });

  describe('storeWithCompensation() — 事务性安全存储与自动补偿', () => {
    it('业务成功时执行单旧文件与多旧文件列表清理', async () => {
      const file = memoryImage(testImageBuffer, 'avatar.png');
      const onStored = vi.fn().mockResolvedValue({ id: 123, avatarUrl: '/uploads/avatars/new.png' });

      const result = await mediaService.storeWithCompensation(
        file,
        { prefix: 'avatars', variants: { thumb: THUMBNAIL_PRESETS.thumb } },
        onStored,
        { oldUrl: '/uploads/avatars/old1.png', oldUrls: ['/uploads/avatars/old2.png', null] },
      );

      expect(onStored).toHaveBeenCalledTimes(1);
      expect(storageMock.delete).toHaveBeenCalledWith('avatars/old1.png');
      expect(storageMock.delete).toHaveBeenCalledWith('avatars/old2.png');
      expect(result).toEqual({ id: 123, avatarUrl: '/uploads/avatars/new.png' });
    });

    it('业务异常时自动回滚新写入的主文件', async () => {
      const file = memoryImage(testImageBuffer, 'avatar.png');
      const onStored = vi.fn().mockRejectedValue(new Error('Database Update Failed'));

      await expect(
        mediaService.storeWithCompensation(
          file,
          { prefix: 'avatars', variants: { thumb: THUMBNAIL_PRESETS.thumb } },
          onStored,
          { oldUrl: '/uploads/avatars/old.png' },
        ),
      ).rejects.toThrow('Database Update Failed');

      expect(storageMock.deleteBatch).toHaveBeenCalledTimes(1);
      expect(storageMock.delete).not.toHaveBeenCalledWith('avatars/old.png');
    });

    it('去重命中已有文件 (isNew: false) 发生业务异常时不删除共享物理文件', async () => {
      storageMock.exists.mockResolvedValue(true); // 命中已有去重文件
      const file = memoryImage(testImageBuffer, 'shared.png');
      const onStored = vi.fn().mockRejectedValue(new Error('Transaction Abort'));

      await expect(mediaService.storeWithCompensation(file, { naming: 'hash' }, onStored)).rejects.toThrow(
        'Transaction Abort',
      );

      expect(storageMock.deleteBatch).not.toHaveBeenCalled();
      expect(storageMock.delete).not.toHaveBeenCalled();
    });
  });

  describe('基础图像方法', () => {
    it('isImage() 校验 MIME 与扩展名', () => {
      expect(mediaService.isImage('image/png')).toBe(true);
      expect(mediaService.isImage('image/jpeg')).toBe(true);
      expect(mediaService.isImage(undefined, 'test.webp')).toBe(true);
      expect(mediaService.isImage('application/pdf')).toBe(false);
    });

    it('getImageMetadata() 正确读取图像分辨率与格式', async () => {
      const meta = await mediaService.getImageMetadata(testImageBuffer);
      expect(meta.width).toBe(400);
      expect(meta.height).toBe(300);
      expect(meta.format).toBe('png');
      expect(meta.aspectRatio).toBeCloseTo(1.3333, 3);
    });
  });

  describe('deleteStored() / deleteByUrl() — 物理文件删除', () => {
    it('deleteStored 按存储路径删除', async () => {
      await mediaService.deleteStored('media/x.png');
      expect(storageMock.delete).toHaveBeenCalledWith('media/x.png');
    });

    it('deleteByUrl 反解 local URL 删除', async () => {
      await mediaService.deleteByUrl('/uploads/media/x.png');
      expect(storageMock.delete).toHaveBeenCalledWith('media/x.png');
    });

    it('deleteByUrl 对非 local URL 跳过', async () => {
      storageMock.urlToPath.mockReturnValueOnce(null);
      await mediaService.deleteByUrl('https://s3.example.com/media/x.png');
      expect(storageMock.delete).not.toHaveBeenCalled();
    });

    it('deleteByUrl 对空串跳过', async () => {
      await mediaService.deleteByUrl('');
      expect(storageMock.delete).not.toHaveBeenCalled();
    });
  });

  describe('QR Code Facade Methods', () => {
    it('generateQrCodeBuffer 应生成有效 Buffer', async () => {
      const buf = await mediaService.generateQrCodeBuffer('https://example.com');
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('generateQrCodeDataUrl 应生成 Data URL 字符串', async () => {
      const url = await mediaService.generateQrCodeDataUrl('https://example.com');
      expect(url).toMatch(/^data:image\//);
    });

    it('generateQrCodeSvg 应生成 SVG 字符串', async () => {
      const svg = await mediaService.generateQrCodeSvg('https://example.com');
      expect(svg).toContain('<svg');
    });

    it('generateAndStoreQrCode 应保存并返回 path 与 url', async () => {
      const res = await mediaService.generateAndStoreQrCode('https://example.com');
      expect(res.path).toMatch(/^qrcodes\//);
      expect(res.url).toMatch(/^\/uploads\/qrcodes\//);
      expect(storageMock.put).toHaveBeenCalled();
    });
  });
});

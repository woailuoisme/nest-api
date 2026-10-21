import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { buildMediaPath, computeFileHash, getUtcDateString, slugify } from '@/common/media/strategies/naming.strategy';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';

function memoryFile(originalname = 'Avatar Image.png', buffer = Buffer.from('test-image-content')): UploadedFile {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'image/png',
    buffer,
    size: buffer.byteLength,
  };
}

/** 一次性流式载荷（模拟 FileStreamInterceptor 产物，`stream` 只能消费一次） */
function streamFile(originalname = 'video.mp4', content = 'stream-content'): UploadedFile {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'video/mp4',
    stream: Readable.from([Buffer.from(content)]),
  } as unknown as UploadedFile;
}

describe('naming.strategy', () => {
  describe('slugify()', () => {
    it('转换包含中文/特殊字符/空格的字符串为合法的 ASCII slug', () => {
      expect(slugify('Hello World!')).toBe('hello-world');
      expect(slugify('My Cool Photo (1).jpeg')).toBe('my-cool-photo-1-jpeg');
      expect(slugify('Café_Au_Lait')).toBe('cafe_au_lait');
      expect(slugify('---hello---')).toBe('hello');
    });
  });

  describe('getUtcDateString()', () => {
    it('返回 8 位 YYYYMMDD 格式', () => {
      const fixedDate = new Date('2026-08-20T12:00:00Z');
      expect(getUtcDateString(fixedDate)).toBe('20260820');
    });
  });

  describe('computeFileHash()', () => {
    it('正确计算 Buffer 的 SHA-256 哈希', async () => {
      const file = memoryFile('test.png', Buffer.from('hello-hash'));
      const hash = await computeFileHash(file);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('buildMediaPath()', () => {
    it('默认策略 (date-uuid)：生成 YYYYMMDD/uuid.ext 格式', async () => {
      const file = memoryFile('test.png');
      const path = await buildMediaPath(file, { prefix: 'avatars' });
      expect(path).toMatch(/^avatars\/\d{8}\/[0-9a-f-]{36}\.png$/);
    });

    it('hash 策略：生成二级散列目录与 sha256 格式', async () => {
      const file = memoryFile('test.png', Buffer.from('unique-content'));
      const path = await buildMediaPath(file, { prefix: 'media', naming: 'hash' });
      expect(path).toMatch(/^media\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    });

    it('hash 策略 + 流式载荷：显式拒绝，避免耗尽流后产出 0 字节文件', async () => {
      await expect(buildMediaPath(streamFile(), { naming: 'hash' })).rejects.toThrow('hash 命名需读取全量内容');
    });

    it('hash 策略 + 流式载荷但已提供 contentBuffer：正常生成路径', async () => {
      const path = await buildMediaPath(streamFile(), { prefix: 'videos', naming: 'hash' }, Buffer.from('stream'));
      expect(path).toMatch(/^videos\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.mp4$/);
    });

    it('slug-random 策略：生成 slug-safe-name 格式', async () => {
      const file = memoryFile('My Great Photo.png');
      const path = await buildMediaPath(file, { prefix: 'products', naming: 'slug-random' });
      expect(path).toMatch(/^products\/\d{8}\/my-great-photo-[0-9a-f]{8}\.png$/);
    });

    it('custom 策略：调用自定义函数生成路径', async () => {
      const file = memoryFile('custom.png');
      const customFn = (f: UploadedFile) => `custom-dir/${f.originalname}`;
      const path = await buildMediaPath(file, { naming: customFn });
      expect(path).toBe('custom-dir/custom.png');
    });

    it('overrideExt 可覆盖文件扩展名 (如转 WebP 时)', async () => {
      const file = memoryFile('avatar.jpg');
      const path = await buildMediaPath(file, { prefix: 'avatars' }, undefined, '.webp');
      expect(path).toMatch(/^avatars\/\d{8}\/[0-9a-f-]{36}\.webp$/);
    });
  });
});

import { createTestPng } from 'tests/factories/image.factory';
import { beforeEach, describe, expect, it } from 'vitest';

import { ImageProcessor } from '@/common/media/processors/image.processor';

describe('ImageProcessor', () => {
  let processor: ImageProcessor;
  let testPngBuffer: Buffer;

  beforeEach(() => {
    processor = new ImageProcessor();
    testPngBuffer = createTestPng(200, 100);
  });

  describe('isImage()', () => {
    it('应正确识别基于 mimetype 的图片', () => {
      expect(processor.isImage('image/png')).toBe(true);
      expect(processor.isImage('image/jpeg')).toBe(true);
      expect(processor.isImage('image/webp')).toBe(true);
      expect(processor.isImage('application/pdf')).toBe(false);
    });

    it('应正确识别基于扩展名的图片', () => {
      expect(processor.isImage(undefined, 'avatar.png')).toBe(true);
      expect(processor.isImage(undefined, 'photo.jpg')).toBe(true);
      expect(processor.isImage(undefined, 'vector.svg')).toBe(true);
      expect(processor.isImage(undefined, 'archive.zip')).toBe(false);
    });
  });

  describe('getImageMetadata()', () => {
    it('应准确返回 PNG 元数据维度、格式与宽高比', async () => {
      const meta = await processor.getImageMetadata(testPngBuffer);
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
      expect(meta.format).toBe('png');
      expect(meta.aspectRatio).toBe(2);
      expect(meta.size).toBe(testPngBuffer.byteLength);
    });

    it('应准确返回 SVG 矢量图元数据', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>');
      const meta = await processor.getImageMetadata(svgBuffer);
      expect(meta.width).toBe(300);
      expect(meta.height).toBe(150);
      expect(meta.format).toBe('svg');
      expect(meta.aspectRatio).toBe(2);
    });

    it('损坏或非法文件应抛出错误', async () => {
      const invalidBuffer = Buffer.from('not an image');
      await expect(processor.getImageMetadata(invalidBuffer)).rejects.toThrow();
    });
  });
});

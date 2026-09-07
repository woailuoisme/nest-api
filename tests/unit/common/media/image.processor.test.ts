import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImageProcessor } from '@/common/media/processors/image.processor';

describe('ImageProcessor', () => {
  let processor: ImageProcessor;
  let testPngBuffer: Buffer;

  beforeEach(async () => {
    processor = new ImageProcessor();
    testPngBuffer = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 4,
        background: { r: 0, g: 128, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
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

  describe('convertToWebp()', () => {
    it('应将 PNG 转换为 WebP 格式并返回有效 Buffer', async () => {
      const { buffer, info } = await processor.convertToWebp(testPngBuffer, { quality: 85 });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(info.format).toBe('webp');
      expect(info.width).toBe(200);
      expect(info.height).toBe(100);
    });
  });

  describe('optimize()', () => {
    it('应自动校正并保持图像格式', async () => {
      const { buffer, info } = await processor.optimize(testPngBuffer);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(info.format).toBe('png');
      expect(info.width).toBe(200);
    });
  });

  describe('transformImage()', () => {
    it('应按指定宽高缩放与格式转换', async () => {
      const { buffer, info } = await processor.transformImage(testPngBuffer, {
        width: 100,
        height: 50,
        format: 'jpeg',
        quality: 90,
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(info.format).toBe('jpeg');
      expect(info.width).toBe(100);
      expect(info.height).toBe(50);
    });
  });

  describe('getImageMetadata()', () => {
    it('应准确返回元数据维度与宽高比', async () => {
      const meta = await processor.getImageMetadata(testPngBuffer);
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
      expect(meta.format).toBe('png');
      expect(meta.aspectRatio).toBe(2);
      expect(meta.hasAlpha).toBe(true);
    });
  });

  describe('processMainImage()', () => {
    it('当 convertToWebp 为 true 时返回 webp 格式', async () => {
      const result = await processor.processMainImage(testPngBuffer, 'image/png', { convertToWebp: true });
      expect(result.contentType).toBe('image/webp');
      expect(result.ext).toBe('.webp');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('当 optimize 为 true (默认) 时返回优化后格式', async () => {
      const result = await processor.processMainImage(testPngBuffer, 'image/png', { optimize: true });
      expect(result.contentType).toBe('image/png');
      expect(result.ext).toBe('.png');
    });

    it('当 optimize 为 false 且未转 webp 时原样返回', async () => {
      const result = await processor.processMainImage(testPngBuffer, 'image/png', { optimize: false });
      expect(result.contentType).toBe('image/png');
      expect(result.ext).toBe('');
      expect(result.buffer).toBe(testPngBuffer);
    });
  });
});

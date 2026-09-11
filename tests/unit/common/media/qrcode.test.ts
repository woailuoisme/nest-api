import { imageSize } from 'image-size';
import { createTestPng } from 'tests/factories/image.factory';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateLogoGeometry, QrCodeService } from '@/common/media';
import { StorageService } from '@/common/storage/storage.service';

describe('calculateLogoGeometry()', () => {
  it('应准确计算 Logo 与白底衬垫几何边界', () => {
    const geo = calculateLogoGeometry(300, 0.2);
    expect(geo.boxSize).toBe(60);
    expect(geo.borderSize).toBe(5);
    expect(geo.innerSize).toBe(50);
    expect(geo.borderRadius).toBe(7);
    expect(geo.offset).toBe(120);
    expect(geo.innerOffset).toBe(125);
  });
});

describe('QrCodeService', () => {
  let qrCodeService: QrCodeService;
  const storageMock = {
    disk: vi.fn().mockReturnThis(),
    put: vi.fn().mockResolvedValue('qrcodes/test.png'),
    getUrl: vi.fn((path: string) => `/uploads/${path}`),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    qrCodeService = new QrCodeService(storageMock as unknown as StorageService);
  });

  describe('generateBuffer()', () => {
    it('生成标准 PNG 二维码 Buffer', async () => {
      const buffer = await qrCodeService.generateBuffer('https://example.com', { width: 200 });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      const size = imageSize(buffer);
      expect(size.type).toBe('png');
      expect(size.width).toBe(200);
      expect(size.height).toBe(200);
    });

    it('生成 SVG 格式二维码 Buffer', async () => {
      const buffer = await qrCodeService.generateBuffer('https://example.com', { width: 200, format: 'svg' });
      const str = buffer.toString('utf-8');
      expect(str).toContain('<svg');
      expect(str).toContain('</svg>');
    });

    it('支持在二维码中心合成 Logo 图标并返回 SVG 矢量 Buffer', async () => {
      const testLogo = createTestPng(50, 50);

      const buffer = await qrCodeService.generateBuffer('https://example.com', {
        width: 300,
        logo: testLogo,
      });

      expect(buffer).toBeInstanceOf(Buffer);
      const str = buffer.toString('utf-8');
      expect(str).toContain('<svg');
      expect(str).toContain('<image');
      expect(str).toContain('data:image/png;base64,');
    });

    it('支持在 SVG 格式二维码中心嵌入 Logo', async () => {
      const testLogo = createTestPng(50, 50);

      const buffer = await qrCodeService.generateBuffer('https://example.com', {
        width: 300,
        format: 'svg',
        logo: testLogo,
      });

      const str = buffer.toString('utf-8');
      expect(str).toContain('<svg');
      expect(str).toContain('<image');
      expect(str).toContain('data:image/png;base64,');
    });
  });

  describe('generateDataUrl()', () => {
    it('返回合法的 data:image/png;base64 DataURL 字符串', async () => {
      const dataUrl = await qrCodeService.generateDataUrl('https://example.com');
      expect(dataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    });

    it('指定 svg 格式时返回 data:image/svg+xml;utf8,... DataURL', async () => {
      const dataUrl = await qrCodeService.generateDataUrl('https://example.com', { format: 'svg' });
      expect(dataUrl).toMatch(/^data:image\/svg\+xml;utf8,/);
      expect(dataUrl).toContain('%3Csvg');
    });
  });

  describe('generateSvg()', () => {
    it('返回合法的 SVG 矢量字符串', async () => {
      const svg = await qrCodeService.generateSvg('https://example.com');
      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('支持在 SVG 字符串中嵌入 Logo', async () => {
      const testLogo = createTestPng(50, 50);

      const svg = await qrCodeService.generateSvg('https://example.com', { logo: testLogo });
      expect(svg).toContain('<rect');
      expect(svg).toContain('<image');
      expect(svg).toContain('data:image/png;base64,');
    });
  });

  describe('generateAndStore()', () => {
    it('生成二维码并直接存储至存储驱动，返回 path 与 url', async () => {
      const result = await qrCodeService.generateAndStore(
        'https://example.com',
        { width: 300 },
        { prefix: 'promo-qr' },
      );

      expect(storageMock.put).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/^promo-qr\/[0-9a-f-]{36}\.png$/);
      expect(result.url).toBe(`/uploads/${result.path}`);
    });

    it('支持 SVG 格式存盘', async () => {
      const result = await qrCodeService.generateAndStore(
        'https://example.com',
        { width: 300, format: 'svg' },
        { prefix: 'svg-qr' },
      );

      expect(storageMock.put).toHaveBeenCalledTimes(1);
      const [path, content, opts] = storageMock.put.mock.calls[0];
      expect(path).toMatch(/^svg-qr\/[0-9a-f-]{36}\.svg$/);
      expect(opts).toEqual({ contentType: 'image/svg+xml' });
      expect(typeof content).toBe('string');
      expect(result.url).toBe(`/uploads/${path}`);
    });
  });
});

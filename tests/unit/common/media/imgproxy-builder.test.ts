import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ImgproxyBuilder } from '@/common/media/imgproxy/imgproxy-builder';
import type { ImgproxyConfig } from '@/common/media/imgproxy/imgproxy.interface';

describe('ImgproxyBuilder', () => {
  const dummyConfig: ImgproxyConfig = {
    key: 'a1b2c3d4',
    salt: '0123456789abcdef',
    endpoint: 'http://localhost:8080',
    publicUrl: 'https://images.example.com',
  };

  it('未配置 config 时安全降级并返回 fallbackBaseUrl 或原路径', () => {
    const builderWithFallback = new ImgproxyBuilder(
      'avatars/pic.png',
      null,
      'local',
      undefined,
      'https://cdn.test.com',
    );
    expect(builderWithFallback.preset('avatar').build()).toBe('https://cdn.test.com/avatars/pic.png');

    const builderWithoutFallback = new ImgproxyBuilder('avatars/pic.png', null);
    expect(builderWithoutFallback.build()).toBe('avatars/pic.png');
  });

  it('Local 驱动下正确解析为 local:/// 路径', () => {
    const builder = new ImgproxyBuilder('photos/pic.jpg', dummyConfig, 'local');
    const url = builder.build();

    expect(url).toContain('/plain/local:///photos/pic.jpg');
    expect(url.startsWith('https://images.example.com/')).toBe(true);
  });

  it('S3 驱动下正确解析为 s3://bucket/ 路径', () => {
    const builder = new ImgproxyBuilder('uploads/item.png', dummyConfig, 's3', 'my-s3-bucket');
    const url = builder.build();

    expect(url).toContain('/plain/s3://my-s3-bucket/uploads/item.png');
  });

  it('若路径已包含 http(s) 协议前缀则保留原样', () => {
    const builder = new ImgproxyBuilder('https://remote.com/pic.jpg', dummyConfig);
    const url = builder.build();

    expect(url).toContain('/plain/https://remote.com/pic.jpg');
  });

  it('正确应用 preset 预设（以 avatar 为例）', () => {
    const builder = new ImgproxyBuilder('avatars/user.png', dummyConfig).preset('avatar');
    const url = builder.build();

    expect(url).toContain('rs:fill:200:200:0:0/g:ce/q:85');
    expect(url).toContain('@webp');
  });

  it('支持快捷格式方法: webp(), png(), jpeg()', () => {
    const urlWebp = new ImgproxyBuilder('img.jpg', dummyConfig).webp(90).build();
    expect(urlWebp).toContain('q:90');
    expect(urlWebp).toContain('@webp');

    const urlPng = new ImgproxyBuilder('img.jpg', dummyConfig).png().build();
    expect(urlPng).toContain('@png');

    const urlJpeg = new ImgproxyBuilder('img.jpg', dummyConfig).jpeg(75).build();
    expect(urlJpeg).toContain('q:75');
    expect(urlJpeg).toContain('@jpeg');
  });

  it('支持兼容旧版 ImageResizeOptions 的 fit 与 position 映射', () => {
    const url = new ImgproxyBuilder('img.png', dummyConfig)
      .resize({
        width: 300,
        height: 200,
        fit: 'cover',
        position: 'top',
        enlarge: true,
      })
      .blur(5)
      .build();

    expect(url).toContain('rs:fill:300:200:1:0/g:no/bl:5');
  });

  it('HMAC-SHA256 签名计算符合官方规范', () => {
    const builder = new ImgproxyBuilder('test.png', dummyConfig).resize(100, 100);
    const resultUrl = builder.build();

    // 提取签名和路径
    // 结构: https://images.example.com/<signature>/<pathToSign>
    const match = resultUrl.match(/^https:\/\/images\.example\.com\/([A-Za-z0-9_-]+)(\/.*)$/);
    expect(match).not.toBeNull();
    if (!match) return;

    const [, actualSignature, pathToSign] = match;

    // 手动根据规范使用 key 与 salt 计算期望签名
    const keyBin = Buffer.from(dummyConfig.key, 'hex');
    const saltBin = Buffer.from(dummyConfig.salt, 'hex'); // '0123456789abcdef' is hex

    const hmac = createHmac('sha256', keyBin);
    hmac.update(saltBin);
    hmac.update(pathToSign);
    const expectedSignature = hmac.digest('base64url');

    expect(actualSignature).toBe(expectedSignature);
  });
});

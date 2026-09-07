/**
 * @UploadedFile / @UploadedFiles 装饰器单元测试
 *
 * 验证装饰器确实将 UploadOptions 写入方法 metadata（MultipartInterceptor 经 Reflector 读取的挂载点）
 */
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { UploadedFile, UploadedFiles } from '@/common/decorators/uploaded.decorator';
import { UPLOAD_OPTIONS_KEY } from '@/common/storage/interfaces/upload.interface';

class DemoController {
  upload(
    @UploadedFile({ maxSize: 1024, allowedMime: ['image/png'] })
    _file: unknown,
  ) {}

  uploadMany(
    @UploadedFiles({ maxSize: 2048, allowedExt: ['.png', '.jpg'] })
    _files: unknown[],
  ) {}
}

describe('上传参数装饰器 metadata', () => {
  it('@UploadedFile 应把 UploadOptions 写入方法 metadata', () => {
    const reflector = new Reflector();

    expect(reflector.get(UPLOAD_OPTIONS_KEY, DemoController.prototype.upload)).toEqual({
      maxSize: 1024,
      allowedMime: ['image/png'],
    });
  });

  it('@UploadedFiles 应把 UploadOptions 写入方法 metadata', () => {
    const reflector = new Reflector();

    expect(reflector.get(UPLOAD_OPTIONS_KEY, DemoController.prototype.uploadMany)).toEqual({
      maxSize: 2048,
      allowedExt: ['.png', '.jpg'],
    });
  });

  it('不传 options 时应写入空对象（仍然触发收集）', () => {
    const reflector = new Reflector();
    class EmptyController {
      upload(@UploadedFile() _file: unknown) {}
    }

    expect(reflector.get(UPLOAD_OPTIONS_KEY, EmptyController.prototype.upload)).toEqual({});
  });
});

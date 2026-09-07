import { Global, Module } from '@nestjs/common';
import { StorageModule } from '@/common/storage/storage.module';
import { MediaCompensationManager } from './managers/compensation.manager';
import { MediaService } from './media.service';
import { ImageProcessor } from './processors/image.processor';
import { QrCodeProcessor } from './processors/qrcode.processor';

/**
 * 全局媒体处理模块 — 提供图像优化、WebP 转换、缩略图多规格衍生、二维码生成与事务补偿核心服务。
 */
@Global()
@Module({
  imports: [StorageModule],
  providers: [
    ImageProcessor,
    QrCodeProcessor,
    MediaCompensationManager,
    MediaService,
    {
      provide: 'QrCodeService',
      useExisting: QrCodeProcessor,
    },
  ],
  exports: [ImageProcessor, QrCodeProcessor, MediaCompensationManager, MediaService],
})
export class MediaModule {}

import { Module } from '@nestjs/common';
import { StorageModule } from '@/common/storage/storage.module';
import { ImgproxyService } from './imgproxy/imgproxy.service';
import { MediaCompensationManager } from './managers/compensation.manager';
import { MediaService } from './media.service';
import { ImageProcessor } from './processors/image.processor';
import { QrCodeProcessor } from './processors/qrcode.processor';

/**
 * 媒体处理模块 — 提供 imgproxy 动态图像、缩略图衍生、二维码生成与事务补偿核心服务。
 *
 * 领域型模块，保持显式 import（不使用 @Global），以维持依赖关系可见性。
 */
@Module({
  imports: [StorageModule],
  providers: [
    ImageProcessor,
    QrCodeProcessor,
    MediaCompensationManager,
    ImgproxyService,
    MediaService,
    {
      provide: 'QrCodeService',
      useExisting: QrCodeProcessor,
    },
  ],
  exports: [ImageProcessor, QrCodeProcessor, MediaCompensationManager, ImgproxyService, MediaService],
})
export class MediaModule {}

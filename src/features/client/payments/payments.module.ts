import { Module } from '@nestjs/common';
import { IdempotencyModule } from '@/common/idempotency';
import { WepayModule } from '@/common/wechat/pay';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * 支付模块（客户端 API）
 *
 * 显式导入 WepayModule（微信支付纯能力）与 IdempotencyModule（回调去重），
 * 使本模块在 AppModule 与 CliModule 两个容器上下文中均可独立装配。
 */
@Module({
  imports: [WepayModule, IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
